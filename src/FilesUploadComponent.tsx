import {
  useEffect,
  useState,
  useContext,
  useCallback,
  useMemo,
  useRef,
} from 'react';
// import moment from 'moment'
// import {MD5,enc} from 'crypto-js'
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Alert from 'react-bootstrap/Alert';
import { GlobalContext, UserContext } from './Context.tsx';
import { uploadOrchestrator } from './upload/core/UploadOrchestrator.ts';
import { saveDirectoryHandle } from './upload/core/dirHandles.ts';
import type { UploadBackend } from './upload/core/types.ts';
import {
  downloadFailedImagesCsv,
  failedImagesCsvName,
} from './upload/failedImagesCsv.ts';
import {
  orientationCorrectionFor,
  orientationGroupForDimensions,
  type CameraOrientationRotations,
  type ImageOrientationGroup,
} from './types/Orientation.ts';
import exifr from 'exifr';
import { DateTime } from 'luxon';
import { fetchAllPaginatedResults } from './utils';
import Papa from 'papaparse';
import GPSSubset from './GPSSubset';
import { parseGPX } from '@we-gold/gpxjs';
import FileInput from './FileInput';
import FolderStructure from './FolderStructure';
import ImageMaskEditor from './ImageMaskEditor.tsx';
import Select from 'react-select';
import localforage from 'localforage';
import CameraOverlap from './CameraOverlap';
import CameraSpecification from './CameraSpecification';
import LabeledToggleSwitch from './LabeledToggleSwitch.tsx';
import { Schema } from './amplify/client-schema.ts';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import UTM from 'utm-latlng';
import {
  buildGpsIndex,
  bracketTimestamp,
  interpolateAt,
  minMaxOf,
} from './survey/new-survey/gpsIndex';
import OrientationReview, {
  OrientationCameraGroup,
} from './survey/new-survey/OrientationReview';
import StepIndicator from './survey/new-survey/StepIndicator';

// Configure a dedicated storage instance for file paths
const fileStore = localforage.createInstance({
  name: 'fileStore',
  storeName: 'files',
});

const metadataStore = localforage.createInstance({
  name: 'metadataStore',
  storeName: 'metadata',
});

interface FilesUploadComponentProps {
  show: boolean;
  handleClose: () => void;
  project?: { id: string; name: string };
  fromStaleUpload?: boolean;
}

// Wizard steps the upload form is split into. 'none' hides every section
// (used while the parent wizard shows its own step, e.g. survey details).
export type UploadWizardStep =
  | 'images'
  | 'georeference'
  | 'cameras'
  | 'review'
  | 'none';

// Shared props for both modal and form versions
interface FilesUploadBaseProps {
  project?: { id: string; name: string };
  setOnSubmit?: React.Dispatch<
    React.SetStateAction<
      ((projectId: string, fromStaleUpload?: boolean) => Promise<any>) | null
    >
  >;
  setReadyToSubmit: React.Dispatch<React.SetStateAction<boolean>>;
  setGpsDataReady?: React.Dispatch<React.SetStateAction<boolean>>;
  newProject?: boolean;
  onShapefileParsed?: (latLngs: [number, number][]) => void;
  /**
   * Wizard step whose section is visible. Undefined renders all sections at
   * once (legacy single-page layout). State lives here regardless of the
   * visible step, so scanning/uploads continue while the user navigates.
   */
  currentStep?: UploadWizardStep;
  /** Signals when the images step is complete (files picked and scanned). */
  setImagesReady?: React.Dispatch<React.SetStateAction<boolean>>;
  /** Values captured by a parent-owned wizard step, shown in the review summary. */
  summaryDetails?: { label: string; value: string }[];
}

// Props for form-compatible version
interface FilesUploadFormProps extends FilesUploadBaseProps { }

export type CameraSpec = {
  focalLengthMm: number;
  sensorWidthMm: number;
  tiltDegrees: number;
};

type GpsData = {
  lat: number | undefined;
  lng: number | undefined;
  alt: number | undefined;
};

type ExifData = Record<
  string,
  {
    width: number;
    height: number;
    timestamp: number;
    cameraSerial: string;
    gpsData: GpsData | null;
    timezone?: string;
  }
>;

type ImageExif = {
  key: string;
  width: number;
  height: number;
  timestamp: number;
  cameraSerial: string;
  gpsData: GpsData | null;
  timezone?: string;
};

type CsvFile = {
  timestamp?: number;
  filepath?: string;
  lat: number;
  lng: number;
  alt: number;
}[];

type CsvData = {
  data: CsvFile;
};

type NormalizedGps = {
  lat: number;
  lng: number;
  alt?: number;
};

const isFiniteWithinRange = (
  value: unknown,
  min: number,
  max: number
): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

const hasValidLatLng = (lat: unknown, lng: unknown): boolean =>
  isFiniteWithinRange(lat, -90, 90) && isFiniteWithinRange(lng, -180, 180);

// Core functionality shared between modal and form versions
export function FileUploadCore({
  setOnSubmit,
  setReadyToSubmit,
  setGpsDataReady,
  newProject = true,
  onShapefileParsed,
  project,
  currentStep,
  setImagesReady,
  summaryDetails,
}: FilesUploadBaseProps) {
  const [name, setName] = useState('');
  const { client, backend } = useContext(GlobalContext)!;
  const { cognitoGroups, user } = useContext(UserContext)!;
  const [scannedFiles, setScannedFiles] = useState<File[]>([]);
  const [directoryHandle, setDirectoryHandle] = useState<unknown>(null);
  const [cameraSelection, setCameraSelection] = useState<
    [string, string[]] | null
  >(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [filteredImageFiles, setFilteredImageFiles] = useState<File[]>([]);
  const [totalImageSize, setTotalImageSize] = useState(0);
  const [exifData, setExifData] = useState<ExifData>({});
  const [commonTimezone, setCommonTimezone] = useState<string | undefined>(
    undefined
  );
  const [missingGpsData, setMissingGpsData] = useState(false);
  const [skipImagesWithoutGps, setSkipImagesWithoutGps] = useState(false);
  const [associateByTimestamp, setAssociateByTimestamp] = useState(false);
  const [minTimestamp, setMinTimestamp] = useState(0);
  const [maxTimestamp, setMaxTimestamp] = useState(0);
  const [file, setFile] = useState<File | undefined>();
  const [scanningEXIF, setScanningEXIF] = useState(false);
  const [csvData, setCsvData] = useState<CsvData | undefined>(undefined);
  const [fullCsvData, setFullCsvData] = useState<CsvFile | undefined>(
    undefined
  );
  const [timeRanges, setTimeRanges] = useState<{
    [day: number]: { start: string; end: string };
  }>({});
  const [cameraSpecs, setCameraSpecs] = useState<Record<string, CameraSpec>>(
    {}
  );
  const [masks, setMasks] = useState<number[][][]>([]);
  // Independent CCW corrections for each camera's landscape and portrait
  // source-image groups; baked into the stored JPEG before processing.
  const [cameraRotations, setCameraRotations] =
    useState<CameraOrientationRotations>({});
  // toUploadFiles / toUploadSize are derived later via useMemo so they
  // automatically reflect the latest existing-image and map-filter state.
  const [existingSurveyImages, setExistingSurveyImages] = useState<
    {
      originalPath: string;
      latitude: number;
      longitude: number;
    }[]
  >([]);
  const [loadingExistingImages, setLoadingExistingImages] = useState(
    !newProject
  );
  const existingImagePoints = useMemo(
    () =>
      existingSurveyImages
        .filter(
          (img) =>
            Number.isFinite(img.latitude) && Number.isFinite(img.longitude)
        )
        .map((img) => ({ lat: img.latitude, lng: img.longitude })),
    [existingSurveyImages]
  );
  const existingImagePathSet = useMemo(
    () =>
      new Set(
        existingSurveyImages
          .map((img) => img.originalPath)
          .filter((p): p is string => Boolean(p))
      ),
    [existingSurveyImages]
  );
  const [model, setModel] = useState<{
    label: string;
    value: string;
  }>({
    label: 'ScoutBot',
    value: 'scoutbot',
  });
  const [overlaps, setOverlaps] = useState<
    { cameraA: string; cameraB: string }[]
  >([]);
  const [multipleCameras, setMultipleCameras] = useState(false);
  // Optional mapping from folder name -> existing camera name, used when
  // uploaded folder names differ from the cameras already on the project.
  const [useFolderCameraMapping, setUseFolderCameraMapping] = useState(false);
  const [folderCameraMapping, setFolderCameraMapping] = useState<
    Record<string, string>
  >({});
  const [altitudeInMeters, setAltitudeInMeters] = useState(true);
  const [altitudeType, setAltitudeType] = useState({
    label: 'EGM96',
    value: 'egm96',
  });
  const altitudeTypeOptions = [
    { label: 'EGM96', value: 'egm96' },
    { label: 'WGS84', value: 'wgs84' },
    { label: 'AGL', value: 'agl' },
  ];
  // State for user-defined column mapping phase
  const [headerFields, setHeaderFields] = useState<string[] | null>(null);
  const [columnMapping, setColumnMapping] = useState<{
    timestamp?: string;
    filepath?: string;
    lat?: string;
    lng?: string;
    alt?: string;
  }>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  // UTM handling
  const [useUtm, setUseUtm] = useState(false);
  const [utmColumn, setUtmColumn] = useState<string | undefined>(undefined);

  // Track visited wizard steps so heavy children (the map and mask editor)
  // only mount once their section is actually visible —
  // maps initialise with a broken 0x0 canvas inside display:none containers.
  const visitedStepsRef = useRef<Set<UploadWizardStep>>(new Set());
  if (currentStep && currentStep !== 'none') {
    visitedStepsRef.current.add(currentStep);
  }
  const stepVisited = (step: UploadWizardStep) =>
    currentStep === undefined || visitedStepsRef.current.has(step);
  // Class-based visibility: Bootstrap's d-flex is display:flex !important,
  // which would defeat an inline display:none, so hidden sections drop the
  // flex class entirely and use d-none instead.
  const sectionClass = (step: UploadWizardStep) =>
    currentStep === undefined || currentStep === step
      ? 'd-flex flex-column gap-2'
      : 'd-none';

  // Helper function to convert altitude from feet to meters if needed
  const convertAltitude = (altitude: number): number => {
    if (!altitudeInMeters) {
      // Convert feet to meters (1 foot = 0.3048 meters)
      return altitude * 0.3048;
    }
    return altitude;
  };

  // Prefetched existing cameras for the project (modal flow)
  const [existingCameraNames, setExistingCameraNames] = useState<string[]>([]);
  const [loadingExistingCameras, setLoadingExistingCameras] = useState(false);

  // State for scan count and total
  const [scanCount, setScanCount] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);

  // State for tracking files that failed during EXIF scanning
  const [failedFiles, setFailedFiles] = useState<
    Array<{ path: string; error: string }>
  >([]);

  // webkitRelativePaths whose csvData row survived the current map/polygon
  // subset. null when csvData isn't populated yet (no filtering applies).
  // Mirrors the matching the submit pipeline uses: by filepath when present,
  // otherwise by exact exif-timestamp match.
  const csvFilteredPathSet = useMemo<Set<string> | null>(() => {
    if (!csvData) return null;
    const validFilepaths = new Set<string>();
    const validTimestamps = new Set<number>();
    for (const row of csvData.data) {
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
      if (row.filepath) validFilepaths.add(row.filepath.toLowerCase());
      if (typeof row.timestamp === 'number') {
        validTimestamps.add(row.timestamp);
      }
    }
    const result = new Set<string>();
    for (const file of imageFiles) {
      const path = file.webkitRelativePath;
      if (validFilepaths.has(path.toLowerCase())) {
        result.add(path);
        continue;
      }
      const exifMeta = exifData[path];
      if (exifMeta && validTimestamps.has(exifMeta.timestamp)) {
        result.add(path);
      }
    }
    return result;
  }, [csvData, imageFiles, exifData]);

  // Files actually destined for upload, post all filters. Drives the count
  // shown in the UI. Phash dedup happens during upload, not here.
  const toUploadFiles = useMemo(() => {
    if (loadingExistingImages) return [] as File[];
    let candidates = newProject
      ? imageFiles
      : imageFiles.filter(
          (file) => !existingImagePathSet.has(file.webkitRelativePath)
        );
    if (csvFilteredPathSet) {
      candidates = candidates.filter((file) =>
        csvFilteredPathSet.has(file.webkitRelativePath)
      );
    }
    return candidates;
  }, [
    imageFiles,
    existingImagePathSet,
    newProject,
    loadingExistingImages,
    csvFilteredPathSet,
  ]);

  const toUploadSize = useMemo(
    () => toUploadFiles.reduce((acc, f) => acc + f.size, 0),
    [toUploadFiles]
  );

  // Indexed lookups over the working (filtered) and full GPS row sets. Every
  // per-image matcher below goes through these instead of scanning the row
  // arrays, which turns several O(n^2) paths into O(n log n) at ~100k images.
  const csvIndex = useMemo(
    () => buildGpsIndex(csvData?.data ?? []),
    [csvData]
  );
  const fullCsvIndex = useMemo(
    () => buildGpsIndex(fullCsvData ?? []),
    [fullCsvData]
  );

  // One landscape/portrait group per camera. Grouping uses the source image's
  // displayed dimensions after its existing EXIF orientation is respected.
  const orientationCameraGroups = useMemo<OrientationCameraGroup[]>(() => {
    const makeGroups = (cameraName: string, files: File[]) => {
      const grouped: Record<ImageOrientationGroup, File[]> = {
        landscape: [],
        portrait: [],
      };
      for (const file of files) {
        const meta = exifData[file.webkitRelativePath];
        if (!meta) continue;
        grouped[
          orientationGroupForDimensions(meta.width, meta.height)
        ].push(file);
      }
      return (['landscape', 'portrait'] as const)
        .filter((orientationGroup) => grouped[orientationGroup].length > 0)
        .map((orientationGroup) => ({
          cameraName,
          orientationGroup,
          files: grouped[orientationGroup],
        }));
    };

    if (filteredImageFiles.length === 0) return [];
    if (!multipleCameras || !cameraSelection || cameraSelection[1].length === 0) {
      return makeGroups('Survey Camera', filteredImageFiles);
    }

    const filesByCamera = new Map<string, File[]>();
    for (const folderName of cameraSelection[1]) {
      const effectiveName =
        (useFolderCameraMapping && folderCameraMapping[folderName]) ||
        folderName;
      const files = filteredImageFiles.filter((file) => {
        const segments = file.webkitRelativePath.split('/');
        segments.pop(); // filename
        return segments.includes(folderName);
      });
      filesByCamera.set(effectiveName, [
        ...(filesByCamera.get(effectiveName) ?? []),
        ...files,
      ]);
    }
    return Array.from(filesByCamera.entries()).flatMap(
      ([cameraName, files]) => makeGroups(cameraName, files)
    );
  }, [
    filteredImageFiles,
    exifData,
    multipleCameras,
    cameraSelection,
    useFolderCameraMapping,
    folderCameraMapping,
  ]);

  const orientationRotationByPath = useMemo(() => {
    const result = new Map<string, number>();
    for (const group of orientationCameraGroups) {
      const rotation = orientationCorrectionFor(
        cameraRotations,
        group.cameraName,
        group.orientationGroup
      );
      if (rotation % 360 === 0) continue;
      for (const file of group.files) {
        result.set(file.webkitRelativePath, rotation);
      }
    }
    return result;
  }, [orientationCameraGroups, cameraRotations]);

  // Handler to confirm column mapping before processing
  const handleConfirmMapping = () => {
    const {
      timestamp: timestampCol,
      filepath: filepathCol,
      lat: latCol,
      lng: lngCol,
    } = columnMapping;
    if (!useUtm) {
      if (!latCol || !lngCol) {
        alert('Please map the Latitude and Longitude columns.');
        return;
      }
    } else {
      if (!utmColumn) {
        alert('Please select the UTM column.');
        return;
      }
    }
    if (!timestampCol && !filepathCol) {
      alert('Please map at least Timestamp or FilePath column.');
      return;
    }
    setMappingConfirmed(true);
  };

  // Extract CSV header fields on file selection or skip for GPX
  useEffect(() => {
    if (!file) return;
    if (file.type === 'text/gpx' || file.name.toLowerCase().endsWith('.gpx')) {
      // GPX files are processed without manual mapping
      setHeaderFields(null);
      setMappingConfirmed(true);
    } else {
      // CSV files: parse only header row to get column names
      Papa.parse(file, {
        header: true,
        preview: 1,
        skipEmptyLines: true,
        complete: (results) => {
          setHeaderFields(results.meta.fields || []);

          const defaultMappings: {
            timestamp?: string;
            filepath?: string;
            lat?: string;
            lng?: string;
            alt?: string;
          } = {};

          for (const field of results.meta.fields || []) {
            switch (field.toLowerCase()) {
              case 'timestamp':
                defaultMappings.timestamp = field;
                break;
              case 'filepath':
                defaultMappings.filepath = field;
                break;
              case 'latitude':
                defaultMappings.lat = field;
                break;
              case 'longitude':
                defaultMappings.lng = field;
                break;
              case 'altitude':
                defaultMappings.alt = field;
                break;
            }
          }
          setColumnMapping(defaultMappings);
          setMappingConfirmed(false);

          // UTM auto-detect: choose a column that contains "utm" in its name
          const utmCandidate = (results.meta.fields || []).find((f) =>
            /utm/i.test(f)
          );
          if (utmCandidate) {
            setUtmColumn(utmCandidate);
            setUseUtm(true);
          } else {
            setUtmColumn(undefined);
            setUseUtm(false);
          }
        },
      });
    }
    // Clear any existing CSV data until mapping confirmed
    setCsvData(undefined);
  }, [file]);

  useEffect(() => {
    setFilteredImageFiles([]);
  }, [name]);

  useEffect(() => {
    setImageFiles(
      scannedFiles.filter((file) => file.type.startsWith('image/jpeg'))
    );
  }, [scannedFiles]);

  useEffect(() => {
    setTotalImageSize(imageFiles.reduce((acc, file) => acc + file.size, 0));
  }, [imageFiles]);

  useEffect(() => {
    if (!multipleCameras) {
      setOverlaps([]);
    }
  }, [multipleCameras]);

  useEffect(() => {
    async function getExistingFiles() {
      // Wait for the existing Image records fetch (driven by a separate effect)
      // to complete before deciding which files still need uploading.
      if (loadingExistingImages) return;

      // Files to actually upload: anything without a matching Image record
      // (matched by originalPath == webkitRelativePath). We deliberately use
      // Image records rather than S3 listings so that files which were
      // uploaded to S3 but never had a record created are re-uploaded.
      const uploadFiles = newProject
        ? imageFiles
        : imageFiles.filter(
          (file) => !existingImagePathSet.has(file.webkitRelativePath)
        );

      // Files to show on map/exif: all for new project, only new for existing
      const mapFiles = newProject ? imageFiles : uploadFiles;
      setFilteredImageFiles(mapFiles);

      const gpsToCSVData: CsvFile = [];
      let missing = false;

      setScanCount(0);
      setScanTotal(mapFiles.length);
      setScanningEXIF(true);
      setFailedFiles([]); // Clear previous failures when starting new scan

      // Progress is accumulated locally and flushed to state on a timer: one
      // state update per file re-renders the whole form ~100k times on large
      // surveys and locks the tab.
      const progress = {
        scanned: 0,
        failed: [] as { path: string; error: string }[],
        flushedFailures: 0,
      };
      const flushProgress = () => {
        setScanCount(progress.scanned);
        if (progress.failed.length !== progress.flushedFailures) {
          progress.flushedFailures = progress.failed.length;
          setFailedFiles([...progress.failed]);
        }
      };
      const flushTimer = setInterval(flushProgress, 250);

      try {
        // Get EXIF metadata for each file (sample first, then selective fast path if no GPS)
        const sampleSize = Math.min(5, mapFiles.length);
        const sampleFiles = mapFiles.slice(0, sampleSize);
        const restFiles = mapFiles.slice(sampleSize);

        // Helper to safely extract EXIF with error handling and validation
        const safeExtractExif = async (
          file: File,
          extractor: (file: File) => Promise<ImageExif>
        ): Promise<ImageExif | null> => {
          try {
            const exif = await extractor(file);

            // Validation checks for corrupted files
            const validationErrors: string[] = [];

            // Check 1: Image dimensions must be valid
            if (!exif.width || !exif.height || exif.width <= 0 || exif.height <= 0) {
              validationErrors.push('Invalid image dimensions');
            }

            // Check 2: Timestamp must be valid (not 0, not NaN, and reasonable date)
            if (!exif.timestamp || !Number.isFinite(exif.timestamp)) {
              validationErrors.push('Invalid timestamp');
            } else {
              // Check if timestamp is reasonable (between 1970 and 2100)
              const minTimestamp = new Date('1970-01-01').getTime();
              const maxTimestamp = new Date('2100-01-01').getTime();
              if (exif.timestamp < minTimestamp || exif.timestamp > maxTimestamp) {
                validationErrors.push('Timestamp out of valid range');
              }
            }

            // Check 3: File size should be reasonable for an image (at least 1KB)
            if (file.size < 1024) {
              validationErrors.push('File size suspiciously small');
            }

            // Check 4: File size should not be 0
            if (file.size === 0) {
              validationErrors.push('File is empty');
            }

            // If validation failed, treat as corrupted file
            if (validationErrors.length > 0) {
              const errorMessage = validationErrors.join('; ');
              console.error(
                `File validation failed for ${file.webkitRelativePath}:`,
                errorMessage
              );
              progress.failed.push({
                path: file.webkitRelativePath,
                error: errorMessage,
              });
              return null;
            }

            return exif;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(
              `Failed to extract EXIF from ${file.webkitRelativePath}:`,
              error
            );
            progress.failed.push({
              path: file.webkitRelativePath,
              error: errorMessage || 'Unknown error',
            });
            return null;
          }
        };

        // Sample with full EXIF to check for GPS
        const sampleResults = await Promise.all(
          sampleFiles.map(async (file) => {
            const exif = await safeExtractExif(file, getExifmeta);
            if (!exif) return null;

            // Validate and convert GPS data
            let gpsData: GpsData | null = null;
            if (exif.gpsData && exif.gpsData.alt && exif.gpsData.lat && exif.gpsData.lng) {
              const lat = Number(exif.gpsData.lat);
              const lng = Number(exif.gpsData.lng);
              // Only set GPS data if coordinates are valid and in range
              if (
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                lat >= -90 &&
                lat <= 90 &&
                lng >= -180 &&
                lng <= 180
              ) {
                gpsData = {
                  lat,
                  lng,
                  alt: convertAltitude(Number(exif.gpsData.alt)),
                };
              }
            }

            const updatedExif: ImageExif = {
              ...exif,
              width: exif.width || 0,
              height: exif.height || 0,
              gpsData,
            };
            return updatedExif;
          })
        );

        // Filter out null results (failed files)
        const sampleRaw: ImageExif[] = sampleResults.filter(
          (exif): exif is ImageExif => exif !== null
        );
        // Update count for all attempts (including failures) to show accurate progress
        progress.scanned += sampleResults.length;

        const gpsLikely = sampleRaw.some((x) => x.gpsData !== null);
        const extractor = gpsLikely ? getExifmeta : getTimestampOnlyExif;

        for (const updatedExif of sampleRaw) {
          if (updatedExif.gpsData === null) {
            missing = true;
          } else {
            gpsToCSVData.push({
              timestamp: updatedExif.timestamp,
              lat: updatedExif.gpsData.lat as number,
              lng: updatedExif.gpsData.lng as number,
              alt: convertAltitude(updatedExif.gpsData.alt as number),
            });
          }
        }

        // Process the rest with limited concurrency using chosen extractor
        const restResults = await mapWithLimit(
          restFiles,
          8,
          async (file) => {
            const exif = await safeExtractExif(file as File, extractor);
            if (!exif) return null;

            // Validate and convert GPS data
            let gpsData: GpsData | null = null;
            if (
              exif.gpsData &&
              (exif.gpsData as any).alt !== undefined &&
              (exif.gpsData as any).lat !== undefined &&
              (exif.gpsData as any).lng !== undefined
            ) {
              const lat = Number((exif.gpsData as any).lat);
              const lng = Number((exif.gpsData as any).lng);
              // Only set GPS data if coordinates are valid and in range
              if (
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                lat >= -90 &&
                lat <= 90 &&
                lng >= -180 &&
                lng <= 180
              ) {
                gpsData = {
                  lat,
                  lng,
                  alt: convertAltitude(Number((exif.gpsData as any).alt)),
                };
              }
            }

            const updatedExif: ImageExif = {
              ...exif,
              width: exif.width || 0,
              height: exif.height || 0,
              gpsData,
            };
            return updatedExif;
          },
          () => {
            progress.scanned += 1;
          }
        );

        // Filter out null results (failed files)
        const restRaw: ImageExif[] = restResults.filter(
          (exif): exif is ImageExif => exif !== null
        );

        for (const updatedExif of restRaw) {
          if (updatedExif.gpsData === null) {
            missing = true;
          } else {
            gpsToCSVData.push({
              timestamp: updatedExif.timestamp,
              lat: (updatedExif.gpsData as any).lat as number,
              lng: (updatedExif.gpsData as any).lng as number,
              alt: convertAltitude((updatedExif.gpsData as any).alt as number),
            });
          }
        }

        const exifData: ImageExif[] = [...sampleRaw, ...restRaw];

        setMissingGpsData(missing);
        if (!missing) {
          setCsvData({
            data: gpsToCSVData,
          });
          setFullCsvData(gpsToCSVData);
          setAssociateByTimestamp(true);
          const tsRange = minMaxOf(
            gpsToCSVData.map((row) => row.timestamp || 0)
          );
          setMinTimestamp(tsRange?.min ?? 0);
          setMaxTimestamp(tsRange?.max ?? 0);
        }

        setExifData(
          (exifData as ImageExif[]).reduce((acc, x) => {
            acc[x.key] = x;
            return acc;
          }, {} as ExifData)
        );

        // Extract common timezone from EXIF data
        const timezones = (exifData as ImageExif[])
          .map((e) => e.timezone)
          .filter(Boolean) as string[];
        const mostCommonTimezone =
          timezones.length > 0 ? timezones[0] : undefined;
        setCommonTimezone(mostCommonTimezone);
      } finally {
        clearInterval(flushTimer);
        flushProgress();
        setScanningEXIF(false);
      }

    }
    if (imageFiles.length > 0) {
      getExistingFiles();
    }
  }, [imageFiles, name, newProject, loadingExistingImages, existingImagePathSet]);

  const handleSkipGps = () => {
    const dummyGpsData: CsvFile = imageFiles.map((f) => ({
      timestamp: exifData[f.webkitRelativePath]?.timestamp || f.lastModified,
      filepath: f.webkitRelativePath,
      lat: 0,
      lng: 0,
      alt: 0,
    }));
    setCsvData({ data: dummyGpsData });
    setFullCsvData(dummyGpsData);
    setMissingGpsData(false);
    setAssociateByTimestamp(false);
    setMappingConfirmed(true);
  };

  useEffect(() => {
    if (!multipleCameras) {
      setCameraSelection(['Survey Level', ['Survey Camera']]);
      setOverlaps([]);
      setUseFolderCameraMapping(false);
      setFolderCameraMapping({});
    }
  }, [multipleCameras]);

  // Reset the folder -> camera mapping (and any orientation corrections keyed
  // by those cameras) whenever the detected folder names change
  const folderNamesKey = cameraSelection?.[1].join('|') ?? '';
  useEffect(() => {
    setFolderCameraMapping({});
    setCameraRotations({});
  }, [folderNamesKey]);

  useEffect(() => {
    if (!project || !project.id) {
      setExistingCameraNames([]);
      return;
    }
    const projectId = project.id;
    let cancelled = false;
    async function fetchExistingCameras() {
      try {
        setLoadingExistingCameras(true);
        const { data } = await client.models.Camera.camerasByProjectId({
          projectId,
        });
        if (!cancelled) {
          setExistingCameraNames(
            (data || []).map((c) => c.name).filter(Boolean)
          );
        }
      } finally {
        if (!cancelled) setLoadingExistingCameras(false);
      }
    }
    fetchExistingCameras();
    return () => {
      cancelled = true;
    };
  }, [client, project?.id]);

  useEffect(() => {
    if (newProject || !project?.id) {
      setExistingSurveyImages([]);
      setLoadingExistingImages(false);
      return;
    }
    const projectId = project.id;
    let cancelled = false;
    async function fetchExistingImages() {
      setLoadingExistingImages(true);
      try {
        const imgs = await fetchAllPaginatedResults(
          client.models.Image.imagesByProjectId,
          {
            projectId,
            limit: 10000,
            selectionSet: [
              'originalPath',
              'latitude',
              'longitude',
            ] as const,
          } as any
        );
        if (!cancelled) {
          setExistingSurveyImages(
            imgs as {
              originalPath: string;
              latitude: number;
              longitude: number;
            }[]
          );
        }
      } catch {
        if (!cancelled) setExistingSurveyImages([]);
      } finally {
        if (!cancelled) setLoadingExistingImages(false);
      }
    }
    fetchExistingImages();
    return () => {
      cancelled = true;
    };
  }, [client, project?.id, newProject]);

  const handleFileInputChange = (files: File[]) => {
    if (files) {
      setScannedFiles(Array.from(files));
      setName(files[0].webkitRelativePath.split('/')[0]);
    }
  };

  // Helper to get image dimensions from the file itself (fallback when EXIF is missing)
  async function getImageDimensionsFromFile(file: File): Promise<{
    width: number;
    height: number;
  }> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      img.src = url;
    });
  }

  async function getExifmeta(file: File) {
    const tags = await exifr.parse(file, {
      pick: [
        'DateTimeOriginal',
        'OffsetTimeOriginal',
        'Orientation',
        'ImageWidth',
        'ImageHeight',
        'ExifImageWidth',
        'ExifImageHeight',
        'InternalSerialNumber',
        'GPSLatitude',
        'GPSLongitude',
        'GPSLatitudeRef',
        'GPSLongitudeRef',
        'GPSAltitude',
        // convenience props sometimes provided by exifr
        'latitude',
        'longitude',
      ],
    });

    const orientation = tags?.Orientation ?? 1;
    const rotated = orientationRequiresSwap(orientation);

    // Build timestamp from DateTimeOriginal + OffsetTimeOriginal (if any)
    let timestamp: number;
    const dto = tags?.DateTimeOriginal as Date | string | undefined;
    const tz = tags?.OffsetTimeOriginal as string | undefined;
    if (dto instanceof Date) {
      // Optimized numeric timezone shift: JS Date is local -> force literal UTC
      timestamp = dto.getTime() - (dto.getTimezoneOffset() * 60000);
      if (tz && tz !== 'Z' && tz !== '+00:00') {
        const offsetMatch = tz.match(/([+-])(\d{2}):?(\d{2})/);
        if (offsetMatch) {
          const sign = offsetMatch[1] === '+' ? 1 : -1;
          const hrs = parseInt(offsetMatch[2]);
          const mins = parseInt(offsetMatch[3]);
          const totalOffsetMs = sign * (hrs * 3600000 + mins * 60000);
          timestamp -= totalOffsetMs;
        }
      }
    } else if (typeof dto === 'string' && dto.length > 0) {
      const dt = DateTime.fromFormat(dto, 'yyyy:MM:dd HH:mm:ss', { zone: tz || 'utc' });
      timestamp = dt.isValid ? dt.toMillis() : file.lastModified;
    } else {
      timestamp = file.lastModified;
    }

    let imageWidth = tags?.ImageWidth ?? tags?.ExifImageWidth ?? 0;
    let imageHeight = tags?.ImageHeight ?? tags?.ExifImageHeight ?? 0;

    // Fallback to reading dimensions from the file if EXIF doesn't have them
    if (imageWidth === 0 || imageHeight === 0) {
      const fileDims = await getImageDimensionsFromFile(file);
      if (fileDims.width > 0 && fileDims.height > 0) {
        imageWidth = fileDims.width;
        imageHeight = fileDims.height;
      }
    }

    // GPS handling: prefer decimal latitude/longitude if provided, else compute from DMS
    let lat: any = tags?.latitude ?? tags?.GPSLatitude;
    let lng: any = tags?.longitude ?? tags?.GPSLongitude;
    const latRef = tags?.GPSLatitudeRef;
    const lngRef = tags?.GPSLongitudeRef;

    if (Array.isArray(lat) && latRef) {
      lat = convertDMSToDD(lat as number[], latRef === 'N' ? 1 : -1);
    }
    if (Array.isArray(lng) && lngRef) {
      lng = convertDMSToDD(lng as number[], lngRef === 'E' ? 1 : -1);
    }

    return {
      key: file.webkitRelativePath,
      width: rotated ? imageHeight : imageWidth,
      height: rotated ? imageWidth : imageHeight,
      timestamp,
      cameraSerial: tags?.InternalSerialNumber ?? '',
      gpsData: {
        lat: lat?.toString(),
        lng: lng?.toString(),
        alt:
          (tags?.GPSAltitude as any)?.toString?.() ??
          (tags?.GPSAltitude as any),
      },
      timezone: tz,
    };
  }

  // Detect and parse timestamp from various formats
  function detectAndParseTimestamp(
    value: any,
    fallbackTimezone?: string
  ): number | null {
    if (!value) return null;
    const str = typeof value === 'string' ? value.trim() : String(value);

    // Try EXIF format: yyyy:MM:dd HH:mm:ss
    const exifFormatMatch = /^\d{4}:\d{2}:\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(str);
    if (exifFormatMatch) {
      const dt = DateTime.fromFormat(str, 'yyyy:MM:dd HH:mm:ss', {
        zone: fallbackTimezone,
      });
      if (dt.isValid) return dt.toMillis();
    }

    // Try ISO-like format: yyyy-MM-dd HH:mm:ss
    const isoFormatMatch = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(str);
    if (isoFormatMatch) {
      const dt = DateTime.fromFormat(str, 'yyyy-MM-dd HH:mm:ss', {
        zone: fallbackTimezone,
      });
      if (dt.isValid) return dt.toMillis();
    }

    // Try US date format: M/d/yyyy h:mm:ss or MM/dd/yyyy HH:mm:ss
    const usDateMatch = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}$/.test(
      str
    );
    if (usDateMatch) {
      const dt = DateTime.fromFormat(str, 'M/d/yyyy h:mm:ss', {
        zone: fallbackTimezone,
      });
      if (dt.isValid) return dt.toMillis();
    }

    // Try US date format with AM/PM: M/d/yyyy h:mm:ss a
    const usDateAmPmMatch =
      /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M$/i.test(str);
    if (usDateAmPmMatch) {
      const dt = DateTime.fromFormat(str, 'M/d/yyyy h:mm:ss a', {
        zone: fallbackTimezone,
      });
      if (dt.isValid) return dt.toMillis();
    }

    // Try ISO 8601 format: yyyy-MM-ddTHH:mm:ss
    const iso8601Match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str);
    if (iso8601Match) {
      const dt = DateTime.fromFormat(str, 'yyyy-MM-ddTHH:mm:ss', {
        zone: fallbackTimezone,
      });
      if (dt.isValid) return dt.toMillis();
    }

    // Try ISO 8601 with Z: yyyy-MM-ddTHH:mm:ssZ
    const iso8601ZMatch = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/i.test(str);
    if (iso8601ZMatch) {
      const dt = DateTime.fromFormat(str, 'yyyy-MM-ddTHH:mm:ssZ', {
        zone: 'utc',
      });
      if (dt.isValid) return dt.toMillis();
    }

    // Try numeric (epoch timestamp)
    const num = Number(str);
    if (Number.isFinite(num) && num > 0) {
      // Auto-detect ms vs seconds: >= 1e12 is milliseconds
      return num >= 1e12 ? num : num * 1000;
    }

    return null;
  }

  // Parse common UTM string formats like: "33S 500000 4649776" or "500000 4649776 33S"
  function parseUtmString(
    utmStr: unknown
  ): { lat: number; lng: number } | null {
    if (!utmStr || typeof utmStr !== 'string') return null;
    const s = utmStr.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
    // Try patterns
    // 1) ZoneLetter first: "33S 500000 4649776"
    let m = s.match(
      /^(\d{1,2})([C-HJ-NP-X])\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)$/i
    );
    let zoneNum: number | null = null;
    let zoneLetter: string | null = null;
    let easting: number | null = null;
    let northing: number | null = null;
    if (m) {
      zoneNum = Number(m[1]);
      zoneLetter = m[2].toUpperCase();
      easting = Number(m[3]);
      northing = Number(m[4]);
    } else {
      // 2) Coordinates first: "500000 4649776 33S"
      m = s.match(
        /^([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+(\d{1,2})([C-HJ-NP-X])$/i
      );
      if (m) {
        easting = Number(m[1]);
        northing = Number(m[2]);
        zoneNum = Number(m[3]);
        zoneLetter = m[4].toUpperCase();
      } else {
        // 3) Tokens fallback
        const tokens = s.split(' ');
        const zl = tokens.find((t) => /^(\d{1,2})([C-HJ-NP-X])$/i.test(t));
        const nums = tokens.filter((t) => /^[0-9]+(?:\.[0-9]+)?$/.test(t));
        if (zl && nums.length >= 2) {
          const mm = zl.match(/^(\d{1,2})([C-HJ-NP-X])$/i)!;
          zoneNum = Number(mm[1]);
          zoneLetter = mm[2].toUpperCase();
          easting = Number(nums[0]);
          northing = Number(nums[1]);
        }
      }
    }
    if (
      zoneNum === null ||
      !zoneLetter ||
      easting === null ||
      northing === null
    )
      return null;
    try {
      const converter = new UTM();
      const res = converter.convertUtmToLatLng(
        easting,
        northing,
        zoneNum,
        zoneLetter
      );
      if (res && typeof res === 'object') {
        const record = res as Record<string, unknown>;
        const latCandidate = record.lat ?? record.Lat;
        const lngCandidate = record.lng ?? record.Lon;
        if (hasValidLatLng(latCandidate, lngCandidate)) {
          return {
            lat: latCandidate as number,
            lng: lngCandidate as number,
          };
        }
      }
    } catch { }
    return null;
  }

  // Helper function to convert DMS (Degrees, Minutes, Seconds) to decimal degrees
  function convertDMSToDD(dms: number[], sign: number): number {
    if (!Array.isArray(dms) || dms.length === 0) return 0;
    const degrees = dms[0] || 0;
    const minutes = dms[1] || 0;
    const seconds = dms[2] || 0;
    return sign * (degrees + minutes / 60 + seconds / 3600);
  }

  function orientationRequiresSwap(orientation: unknown): boolean {
    if (typeof orientation === 'number') {
      return orientation > 4;
    }
    if (typeof orientation === 'string') {
      const o = orientation.toLowerCase();
      return (
        o.includes('90') ||
        o.includes('270') ||
        o.includes('transpose') ||
        o.includes('transverse') ||
        o.includes('mirror horizontal and rotate') ||
        o.includes('mirror vertical and rotate')
      );
    }
    return false;
  }

  // Fast path: read only timestamp and a few lightweight fields using exifr
  async function getTimestampOnlyExif(file: File) {
    const tags = await exifr.parse(file, {
      pick: [
        'DateTimeOriginal',
        'OffsetTimeOriginal',
        'Orientation',
        'ImageWidth',
        'ImageHeight',
        'ExifImageWidth',
        'ExifImageHeight',
        'InternalSerialNumber',
      ],
    });

    const orientation = (tags as any)?.Orientation ?? 1;
    const rotated = orientationRequiresSwap(orientation);

    // Build timestamp from DateTimeOriginal + OffsetTimeOriginal (if any)
    let timestamp: number;
    const dto = (tags as any)?.DateTimeOriginal;
    const tz = (tags as any)?.OffsetTimeOriginal as string | undefined;
    if (dto instanceof Date) {
      // Optimized numeric timezone shift: JS Date is local -> force literal UTC
      timestamp = dto.getTime() - (dto.getTimezoneOffset() * 60000);
      if (tz && tz !== 'Z' && tz !== '+00:00') {
        const offsetMatch = tz.match(/([+-])(\d{2}):?(\d{2})/);
        if (offsetMatch) {
          const sign = offsetMatch[1] === '+' ? 1 : -1;
          const hrs = parseInt(offsetMatch[2]);
          const mins = parseInt(offsetMatch[3]);
          const totalOffsetMs = sign * (hrs * 3600000 + mins * 60000);
          timestamp -= totalOffsetMs;
        }
      }
    } else if (typeof dto === 'string' && dto.length > 0) {
      const dt = DateTime.fromFormat(dto, 'yyyy:MM:dd HH:mm:ss', { zone: tz || 'utc' });
      timestamp = dt.isValid ? dt.toMillis() : file.lastModified;
    } else {
      timestamp = file.lastModified;
    }

    let imageWidth =
      (tags as any)?.ImageWidth ?? (tags as any)?.ExifImageWidth ?? 0;
    let imageHeight =
      (tags as any)?.ImageHeight ?? (tags as any)?.ExifImageHeight ?? 0;

    // Fallback to reading dimensions from the file if EXIF doesn't have them
    if (imageWidth === 0 || imageHeight === 0) {
      const fileDims = await getImageDimensionsFromFile(file);
      if (fileDims.width > 0 && fileDims.height > 0) {
        imageWidth = fileDims.width;
        imageHeight = fileDims.height;
      }
    }

    return {
      key: file.webkitRelativePath,
      width: rotated ? imageHeight : imageWidth,
      height: rotated ? imageWidth : imageHeight,
      timestamp,
      cameraSerial: (tags as any)?.InternalSerialNumber ?? '',
      gpsData: null as GpsData | null,
      timezone: tz,
    };
  }

  const getGpsForFile = useCallback(
    (sourceFile: File): NormalizedGps | null => {
      const exifmeta = exifData[sourceFile.webkitRelativePath];
      if (!exifmeta) {
        return null;
      }

      const pickFromExif = () => {
        const gps = exifmeta.gpsData;
        if (!gps) return null;
        const latNum = typeof gps.lat === 'number' ? gps.lat : Number(gps.lat);
        const lngNum = typeof gps.lng === 'number' ? gps.lng : Number(gps.lng);
        const altNum =
          gps.alt === undefined || gps.alt === null
            ? undefined
            : Number(gps.alt);
        if (!hasValidLatLng(latNum, lngNum)) {
          return null;
        }
        const normalized: NormalizedGps = {
          lat: latNum,
          lng: lngNum,
          alt:
            altNum !== undefined && Number.isFinite(altNum)
              ? convertAltitude(altNum)
              : undefined,
        };
        return normalized;
      };

      if (!csvData || csvData.data.length === 0) {
        return pickFromExif();
      }

      if (associateByTimestamp) {
        const timestamp = exifmeta.timestamp;
        const exactRow = csvIndex.byTimestamp.get(timestamp);
        if (exactRow && hasValidLatLng(exactRow.lat, exactRow.lng)) {
          const alt =
            typeof exactRow.alt === 'number' && Number.isFinite(exactRow.alt)
              ? exactRow.alt
              : undefined;
          const normalized: NormalizedGps = {
            lat: exactRow.lat,
            lng: exactRow.lng,
            alt,
          };
          return normalized;
        }

        const interpolated = interpolateAt(csvIndex, timestamp);
        if (interpolated && hasValidLatLng(interpolated.lat, interpolated.lng)) {
          const alt = Number.isFinite(interpolated.alt)
            ? interpolated.alt
            : undefined;
          const normalized: NormalizedGps = {
            lat: interpolated.lat,
            lng: interpolated.lng,
            alt,
          };
          return normalized;
        }

        return null;
      }

      const csvRow = csvIndex.byFilepath.get(
        sourceFile.webkitRelativePath.toLowerCase()
      );

      if (csvRow && hasValidLatLng(csvRow.lat, csvRow.lng)) {
        const alt =
          typeof csvRow.alt === 'number' && Number.isFinite(csvRow.alt)
            ? csvRow.alt
            : undefined;
        const normalized: NormalizedGps = {
          lat: csvRow.lat,
          lng: csvRow.lng,
          alt,
        };
        return normalized;
      }

      return null;
    },
    [associateByTimestamp, csvData, csvIndex, exifData]
  );

  // Check for truly missing GPS files using fullCsvData (unfiltered).
  // Files that have GPS in the original data but are filtered out should NOT
  // appear as "missing GPS" - they're just excluded from the current selection.
  const invalidGpsFiles = useMemo(() => {
    if (filteredImageFiles.length === 0) {
      return [] as string[];
    }

    // Create a set of failed file paths for quick lookup
    const failedFilePaths = new Set(failedFiles.map((f) => f.path));

    return filteredImageFiles
      .filter((file) => {
        // Exclude files that failed validation/corruption checks
        if (failedFilePaths.has(file.webkitRelativePath)) {
          return false; // Don't include failed files in invalid GPS list
        }

        const exifmeta = exifData[file.webkitRelativePath];
        if (!exifmeta) return true; // No EXIF metadata = truly invalid

        // Check EXIF GPS first
        const gps = exifmeta.gpsData;
        if (gps) {
          const latNum = typeof gps.lat === 'number' ? gps.lat : Number(gps.lat);
          const lngNum = typeof gps.lng === 'number' ? gps.lng : Number(gps.lng);
          if (hasValidLatLng(latNum, lngNum)) {
            return false; // Has valid GPS from EXIF
          }
        }

        // Check fullCsvData (unfiltered GPS data) - NOT csvData
        if (!fullCsvData || fullCsvData.length === 0) {
          return true; // No GPS data available at all
        }

        if (associateByTimestamp) {
          const timestamp = exifmeta.timestamp;
          // Check for exact timestamp match in full data
          const exactRow = fullCsvIndex.byTimestamp.get(timestamp);
          if (exactRow && hasValidLatLng(exactRow.lat, exactRow.lng)) {
            return false; // Has valid GPS in the original full data
          }
          // Check if interpolation would be possible using full data
          if (
            fullCsvIndex.sorted.length >= 2 &&
            timestamp >= fullCsvIndex.minTimestamp &&
            timestamp <= fullCsvIndex.maxTimestamp
          ) {
            return false; // Can interpolate GPS from full data
          }
          return true; // Truly cannot get GPS
        } else {
          // Associate by filepath - check against full data
          const csvRow = fullCsvIndex.byFilepath.get(
            file.webkitRelativePath.toLowerCase()
          );
          return !csvRow || !hasValidLatLng(csvRow.lat, csvRow.lng);
        }
      })
      .map((file) => file.webkitRelativePath);
  }, [filteredImageFiles, exifData, fullCsvData, fullCsvIndex, associateByTimestamp, failedFiles]);

  const hasValidGpsForAllImages =
    filteredImageFiles.length > 0 &&
    (invalidGpsFiles.length === 0 || skipImagesWithoutGps);

  useEffect(() => {
    if (setImagesReady) {
      setImagesReady(
        imageFiles.length > 0 &&
          !scanningEXIF &&
          !loadingExistingImages &&
          Object.keys(exifData).length > 0
      );
    }
  }, [
    setImagesReady,
    imageFiles,
    scanningEXIF,
    loadingExistingImages,
    exifData,
  ]);

  useEffect(() => {
    if (setGpsDataReady) {
      setGpsDataReady(
        !scanningEXIF &&
        !loadingExistingImages &&
        hasValidGpsForAllImages &&
        Boolean(csvData && csvData.data.length > 0)
      );
    }
  }, [
    setGpsDataReady,
    scanningEXIF,
    loadingExistingImages,
    hasValidGpsForAllImages,
    csvData,
  ]);

  useEffect(() => {
    const hasData =
      !loadingExistingImages &&
      hasValidGpsForAllImages &&
      Boolean(csvData && csvData.data.length > 0);
    setReadyToSubmit(hasData);
  }, [loadingExistingImages, hasValidGpsForAllImages, csvData, setReadyToSubmit]);

  // Simple concurrency limiter for mapping large arrays without blocking UI
  // Now handles errors gracefully - failed items will be null in results
  async function mapWithLimit<T, U>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<U | null>,
    onProgress?: (index: number) => void
  ): Promise<(U | null)[]> {
    const results: (U | null)[] = new Array(items.length);
    let nextIndex = 0;
    let active = 0;

    return new Promise<(U | null)[]>((resolve) => {
      const launch = () => {
        while (active < limit && nextIndex < items.length) {
          const current = nextIndex++;
          active++;
          mapper(items[current], current)
            .then((res) => {
              results[current] = res;
              if (onProgress) onProgress(current);
            })
            .catch((err) => {
              // Log error but don't fail the entire operation
              console.error(
                `Error processing item at index ${current}:`,
                err
              );
              results[current] = null;
              if (onProgress) onProgress(current);
            })
            .then(() => {
              active--;
              if (
                results.length === items.length &&
                nextIndex >= items.length &&
                active === 0
              ) {
                resolve(results);
              } else {
                launch();
              }
            });
        }
        if (nextIndex >= items.length && active === 0) {
          resolve(results);
        }
      };
      launch();
    });
  }

  const handleSubmit = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        alert('Survey is required');
        return;
      }

      if (!csvData) {
        alert('GPS metadata is required');
        return;
      }

      if (invalidGpsFiles.length > 0 && !skipImagesWithoutGps) {
        const sample = invalidGpsFiles.slice(0, 5);
        alert(
          `GPS coordinates are missing or invalid for ${invalidGpsFiles.length
          } image${invalidGpsFiles.length === 1 ? '' : 's'}. Example${sample.length === 1 ? '' : 's'
          }: ${sample.join(', ')}`
        );
        return;
      }

      // Fetch project to get organizationId for group-based access
      const { data: proj } = await client.models.Project.get(
        { id: projectId },
        { selectionSet: ['id', 'organizationId'] as const }
      );
      const organizationId: string | undefined =
        typeof proj?.organizationId === 'string'
          ? proj.organizationId
          : undefined;

      const allCameras: Schema['Camera']['type'][] = [];

      const existingCameras =
        (
          await client.models.Camera.camerasByProjectId({
            projectId,
          })
        ).data || [];

      for (const camera of existingCameras) {
        allCameras.push(camera);
      }

      // Resolve folder names through the saved camera mapping when active.
      const folderCameraNames = cameraSelection
        ? cameraSelection[1]
        : ['Survey Camera'];
      const resolveCameraName = (folderName: string): string =>
        (useFolderCameraMapping && folderCameraMapping[folderName]) ||
        folderName;

      // Create or update all cameras, even if they don't have specs
      for (const folderName of folderCameraNames) {
        const isMapped =
          useFolderCameraMapping && !!folderCameraMapping[folderName];
        const effectiveName = resolveCameraName(folderName);
        const existingCamera = existingCameras.find(
          (c) => c.name === effectiveName
        );

        // Mapped folders reuse the existing camera without overwriting specs.
        if (isMapped) {
          if (existingCamera) allCameras.push(existingCamera);
          continue;
        }

        const spec = cameraSpecs[folderName] || {
          focalLengthMm: 0,
          sensorWidthMm: 0,
          tiltDegrees: 0,
        };

        if (existingCamera) {
          await client.models.Camera.update({
            id: existingCamera.id,
            name: effectiveName,
            focalLengthMm: spec.focalLengthMm || 0,
            sensorWidthMm: spec.sensorWidthMm || 0,
            tiltDegrees: spec.tiltDegrees || 0,
          });
        } else {
          const { data: newCamera } = await client.models.Camera.create({
            name: effectiveName,
            projectId: projectId,
            focalLengthMm: spec.focalLengthMm || 0,
            sensorWidthMm: spec.sensorWidthMm || 0,
            tiltDegrees: spec.tiltDegrees || 0,
            group: organizationId,
          });
          if (newCamera) {
            allCameras.push(newCamera);
          }
        }
      }

      for (const overlap of overlaps) {
        const overlapA = resolveCameraName(overlap.cameraA);
        const overlapB = resolveCameraName(overlap.cameraB);
        const cameraA = allCameras.find((c) => c.name === overlapA);

        const cameraB = allCameras.find((c) => c.name === overlapB);

        if (cameraA && cameraB) {
          const existingOverlap = (
            await client.models.CameraOverlap.get({
              cameraAId: cameraA.id,
              cameraBId: cameraB.id,
            })
          ).data;

          if (!existingOverlap) {
            await client.models.CameraOverlap.create({
              cameraAId: cameraA.id,
              cameraBId: cameraB.id,
              projectId: projectId,
              group: organizationId,
            });
          }
        }
      }

      const imageSets = await fetchAllPaginatedResults(
        client.models.ImageSet.list,
        { filter: { projectId: { eq: projectId } }, selectionSet: ['id'] }
      );

      // Create the survey image set if it is missing.
      if (imageSets.length === 0) {
        await client.models.ImageSet.create({
          name: name,
          projectId: projectId,
          group: organizationId,
        });
      }

      const failedFilePaths = new Set(failedFiles.map((f) => f.path));

      const gpsFilteredImageFiles = filteredImageFiles.filter((file) => {
        if (failedFilePaths.has(file.webkitRelativePath)) {
          return false;
        }

        const exifMeta = exifData[file.webkitRelativePath];

        if (!exifMeta) {
          return false;
        }

        if (exifMeta.gpsData) {
          return csvIndex.byTimestamp.has(exifMeta.timestamp);
        } else {
          if (associateByTimestamp) {
            if (csvIndex.byTimestamp.has(exifMeta.timestamp)) {
              return true;
            }
            const bracket = bracketTimestamp(csvIndex, exifMeta.timestamp);
            if (!bracket) {
              return false;
            }
            const intervalGap =
              (bracket.next.timestamp as number) -
              (bracket.prev.timestamp as number);
            // Treat much larger gaps than the mean sampling interval as
            // dropped GPS data.
            const thresholdFactor = 2;
            return !(intervalGap > csvIndex.avgInterval * thresholdFactor);
          } else {
            return csvIndex.byFilepath.has(
              file.webkitRelativePath.toLowerCase()
            );
          }
        }
      });

      const images = [] as {
        width: number;
        height: number;
        timestamp: number;
        cameraSerial: string;
        originalPath: string;
        sourceOrientationGroup: ImageOrientationGroup;
        latitude: number;
        longitude: number;
        altitude_egm96?: number;
        altitude_wgs84?: number;
        altitude_agl?: number;
      }[];

      // Phash dedup runs during upload.
      for (const file of gpsFilteredImageFiles) {
        const exifmeta = exifData[file.webkitRelativePath];
        const gpsData = getGpsForFile(file);

        if (!exifmeta || !gpsData) {
          console.warn(
            `Skipping image ${file.webkitRelativePath} due to missing GPS metadata.`
          );
          continue;
        }

        const sourceOrientationGroup = orientationGroupForDimensions(
          exifmeta.width,
          exifmeta.height
        );
        const rotation =
          orientationRotationByPath.get(file.webkitRelativePath) ?? 0;
        const swapsDimensions = rotation % 180 !== 0;
        const width = swapsDimensions ? exifmeta.height : exifmeta.width;
        const height = swapsDimensions ? exifmeta.width : exifmeta.height;
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0
        ) {
          console.warn(
            `Skipping image ${file.webkitRelativePath} due to invalid dimensions (width: ${width}, height: ${height}).`
          );
          continue;
        }

        const altitudeValue = gpsData.alt;

        images.push({
          width,
          height,
          timestamp: Math.floor(exifmeta.timestamp / 1000),
          cameraSerial: exifmeta.cameraSerial,
          originalPath: file.webkitRelativePath,
          sourceOrientationGroup,
          latitude: gpsData.lat,
          longitude: gpsData.lng,
          altitude_egm96:
            altitudeType.value === 'egm96' ? altitudeValue : undefined,
          altitude_wgs84:
            altitudeType.value === 'wgs84' ? altitudeValue : undefined,
          altitude_agl:
            altitudeType.value === 'agl' ? altitudeValue : undefined,
        });
      }

      // Merge stored manifest entries so retry/resume keeps prior metadata.
      const existingStoredImages =
        ((await fileStore.getItem(projectId)) as typeof images) ?? [];
      const newPaths = new Set(images.map((img) => img.originalPath));
      const merged = [
        ...existingStoredImages.filter(
          (img) => !newPaths.has(img.originalPath)
        ),
        ...images,
      ];
      await fileStore.setItem(projectId, merged);
      const activeRotations = Object.fromEntries(
        Object.entries(cameraRotations)
          .map(([cameraName, groups]) => [
            cameraName,
            Object.fromEntries(
              Object.entries(groups).filter(([, deg]) =>
                deg === undefined ? false : deg % 360 !== 0
              )
            ),
          ])
          .filter(([, groups]) => Object.keys(groups).length > 0)
      ) as CameraOrientationRotations;
      await metadataStore.setItem(projectId, {
        model: model.value,
        masks: masks,
        folderCameraMapping: useFolderCameraMapping ? folderCameraMapping : {},
        rotations: activeRotations,
      });

      // Save the handle so reload resume can avoid another folder picker.
      if (directoryHandle) {
        await saveDirectoryHandle(projectId, directoryHandle);
      }

      // Include every manifest file: a DB record may exist before its S3 object,
      // so resume filtering alone can omit a file that still needs uploading.
      const mergedPaths = new Set(merged.map((img) => img.originalPath));
      const sessionFiles = new Map<string, File>(
        gpsFilteredImageFiles.map((f) => [f.webkitRelativePath, f])
      );
      for (const f of imageFiles) {
        if (
          mergedPaths.has(f.webkitRelativePath) &&
          !sessionFiles.has(f.webkitRelativePath)
        ) {
          sessionFiles.set(f.webkitRelativePath, f);
        }
      }

      uploadOrchestrator.start({
        client,
        backend: backend as unknown as UploadBackend,
        projectId,
        userId: user.userId,
        files: Array.from(sessionFiles.values()),
      });
    },
    [
      filteredImageFiles,
      imageFiles,
      exifData,
      getGpsForFile,
      altitudeType,
      csvData,
      csvIndex,
      associateByTimestamp,
      invalidGpsFiles,
      skipImagesWithoutGps,
      cameraSpecs,
      overlaps,
      client,
      backend,
      user.userId,
      name,
      model,
      masks,
      cameraRotations,
      orientationRotationByPath,
      directoryHandle,
      useFolderCameraMapping,
      folderCameraMapping,
    ]
  );

  // Register the submit handler with the parent form if provided
  useEffect(() => {
    if (setOnSubmit) {
      setOnSubmit(() => handleSubmit);
    }
  }, [setOnSubmit, handleSubmit]);

  useEffect(() => {
    if (!file || !mappingConfirmed) return;
    async function transformFile(file: File) {
      // Check for GPX files by both type and extension
      if (
        file.type === 'text/gpx' ||
        file.name.toLowerCase().endsWith('.gpx')
      ) {
        setAssociateByTimestamp(true);

        const text = await file.text();
        const [gpxFile, error] = parseGPX(text);

        if (error) {
          console.error('Error parsing GPX file:', error);
          return;
        }

        if (!gpxFile.tracks || gpxFile.tracks.length === 0) {
          alert('No tracks found in GPX file');
          console.error('No tracks found in GPX file');
          return;
        }

        // Build raw GPX track points
        const allPoints = gpxFile.tracks.flatMap((track) =>
          track.points.map((point) => ({
            timestamp: Number(point.time),
            lat: point.latitude,
            lng: point.longitude,
            alt: convertAltitude(point.elevation || 0),
          }))
        );

        if (allPoints.length === 0) {
          alert(
            'No trackpoints found in the GPX file. Please ensure the file contains track segments with individual trackpoints.'
          );
          return;
        }

        // Check for missing timestamps
        const pointsWithValidTime = allPoints.filter((p) =>
          Number.isFinite(p.timestamp)
        );
        if (pointsWithValidTime.length === 0) {
          alert(
            'The GPX file does not contain valid timestamps on its trackpoints. Each <trkpt> must include a <time> element. Please re-export the file with timestamps included.'
          );
          return;
        }

        const rawPoints = allPoints
          .filter((point) => {
            // Validate GPS coordinates and timestamp are valid numbers and in range
            return (
              Number.isFinite(point.timestamp) &&
              Number.isFinite(point.lat) &&
              Number.isFinite(point.lng) &&
              Number.isFinite(point.alt) &&
              point.lat >= -90 &&
              point.lat <= 90 &&
              point.lng >= -180 &&
              point.lng <= 180
            );
          })
          .sort((a, b) => a.timestamp - b.timestamp);

        if (rawPoints.length === 0) {
          alert(
            'No valid trackpoints found in the GPX file. All points had invalid coordinates or timestamps.'
          );
          return;
        }

        // Georeference each image by EXIF timestamp
        const gpxIndex = buildGpsIndex(rawPoints);
        const imagePoints = filteredImageFiles
          .map((imgFile) => {
            const meta = exifData[imgFile.webkitRelativePath];
            if (!meta) {
              console.warn(
                `No EXIF metadata for image ${imgFile.webkitRelativePath}`
              );
              return null;
            }
            const ts = meta.timestamp;
            const gps = interpolateAt(gpxIndex, ts);
            if (!gps) {
              console.warn(
                `Timestamp outside of GPX data range for image ${imgFile.webkitRelativePath}`
              );
              return null;
            }
            return {
              timestamp: ts,
              filepath: imgFile.webkitRelativePath,
              lat: gps.lat,
              lng: gps.lng,
              alt: gps.alt,
            };
          })
          .filter((pt) => pt !== null) as CsvFile;

        // Update CSV data and bounds for images
        setCsvData({ data: imagePoints });
        setFullCsvData(imagePoints);
        const imgRange = minMaxOf(imagePoints.map((pt) => pt.timestamp!));
        setMinTimestamp(imgRange?.min ?? 0);
        setMaxTimestamp(imgRange?.max ?? 0);

        // Initialize time ranges based on image timestamps
        const initialRanges: { [day: number]: { start: string; end: string } } =
          {};
        const dayGroups: { [day: number]: number[] } = {};

        imagePoints.forEach(({ timestamp }) => {
          const date = new Date(timestamp!);
          const day = date.getUTCDate();
          const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
          if (!dayGroups[day]) dayGroups[day] = [];
          dayGroups[day].push(minutes);
        });

        Object.keys(dayGroups).forEach((dayStr) => {
          const day = parseInt(dayStr);
          const range = minMaxOf(dayGroups[day]);
          initialRanges[day] = {
            start: minutesToTime(range?.min ?? 0),
            end: minutesToTime(range?.max ?? 1439),
          };
        });
        setTimeRanges(initialRanges);

        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
          // Apply user-defined column mapping
          const mappedData = (results.data as any[]).map((row: any) => {
            const newRow: any = { ...row };
            if (columnMapping.timestamp)
              newRow['Timestamp'] = row[columnMapping.timestamp];
            if (columnMapping.filepath)
              newRow['FilePath'] = row[columnMapping.filepath];
            if (!useUtm) {
              if (columnMapping.lat)
                newRow['Latitude'] = row[columnMapping.lat];
              if (columnMapping.lng)
                newRow['Longitude'] = row[columnMapping.lng];
            } else if (utmColumn) {
              newRow['UTM'] = row[utmColumn];
            }
            if (columnMapping.alt) newRow['Altitude'] = row[columnMapping.alt];
            return newRow;
          });
          results.data = mappedData;

          const hasTimestamp = results.data.some(
            (row: any) => row['Timestamp']
          );
          const hasFilepath = results.data.some((row: any) => row['FilePath']);
          const hasUtm = useUtm && results.data.some((row: any) => row['UTM']);
          setAssociateByTimestamp(hasTimestamp && !hasFilepath);
          // Build raw CSV data
          const rawData = results.data
            .map((row: any) => {
              let lat: number | undefined;
              let lng: number | undefined;
              if (hasUtm) {
                const conv = parseUtmString(row['UTM']);
                if (conv) {
                  lat = conv.lat;
                  lng = conv.lng;
                }
              } else {
                lat = Number(row['Latitude']);
                lng = Number(row['Longitude']);
              }
              return {
                timestamp: hasTimestamp
                  ? detectAndParseTimestamp(row['Timestamp'], commonTimezone) ??
                  undefined
                  : undefined,
                filepath: hasFilepath ? row['FilePath'] : undefined,
                lat: lat as number,
                lng: lng as number,
                alt: convertAltitude(Number(row['Altitude'])),
              };
            })
            .filter((row) => {
              // Validate timestamp if present
              if (hasTimestamp && row.timestamp === null) {
                return false;
              }
              // Validate GPS coordinates are valid numbers
              if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
                return false;
              }
              // Validate lat is in valid range (-90 to 90)
              if (row.lat < -90 || row.lat > 90) {
                return false;
              }
              // Validate lng is in valid range (-180 to 180)
              if (row.lng < -180 || row.lng > 180) {
                return false;
              }
              return true;
            })
            .sort((a, b) =>
              hasTimestamp
                ? a.timestamp! - b.timestamp!
                : a
                  .filepath!.toLowerCase()
                  .localeCompare(b.filepath!.toLowerCase())
            );
          const rawIndex = buildGpsIndex(rawData);
          if (hasTimestamp && !hasFilepath) {
            // Georeference each image by EXIF timestamp
            const imagePoints = filteredImageFiles
              .map((imgFile) => {
                const meta = exifData[imgFile.webkitRelativePath];
                if (!meta) {
                  console.warn(
                    `No EXIF metadata for image ${imgFile.webkitRelativePath}`
                  );
                  return null;
                }
                const ts = meta.timestamp;
                const gps = interpolateAt(rawIndex, ts);
                if (!gps) {
                  console.warn(
                    `Timestamp outside of CSV data range for image ${imgFile.webkitRelativePath}`
                  );
                  return null;
                }
                return {
                  timestamp: ts,
                  filepath: imgFile.webkitRelativePath,
                  lat: gps.lat,
                  lng: gps.lng,
                  alt: gps.alt,
                };
              })
              .filter((pt) => pt !== null) as CsvFile;
            setCsvData({ data: imagePoints });
            setFullCsvData(imagePoints);
            // Update bounds based on image points
            const imgRange = minMaxOf(imagePoints.map((pt) => pt.timestamp!));
            setMinTimestamp(imgRange?.min ?? 0);
            setMaxTimestamp(imgRange?.max ?? 0);

            // Initialize time ranges based on image timestamps
            const initialRanges: {
              [day: number]: { start: string; end: string };
            } = {};
            const dayGroups: { [day: number]: number[] } = {};

            imagePoints.forEach(({ timestamp }) => {
              const date = new Date(timestamp!);
              const day = date.getUTCDate();
              const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
              if (!dayGroups[day]) dayGroups[day] = [];
              dayGroups[day].push(minutes);
            });

            Object.keys(dayGroups).forEach((dayStr) => {
              const day = parseInt(dayStr);
              const range = minMaxOf(dayGroups[day]);
              initialRanges[day] = {
                start: minutesToTime(range?.min ?? 0),
                end: minutesToTime(range?.max ?? 1439),
              };
            });
            setTimeRanges(initialRanges);
          } else if (!hasTimestamp && hasFilepath) {
            // Georeference each image by matching CSV filepaths
            const imagePoints = filteredImageFiles
              .map((imgFile) => {
                const match = rawIndex.byFilepath.get(
                  imgFile.webkitRelativePath.toLowerCase()
                );
                if (!match) return null;
                return {
                  timestamp: match.timestamp,
                  filepath: imgFile.webkitRelativePath,
                  lat: match.lat,
                  lng: match.lng,
                  alt: match.alt,
                };
              })
              .filter((pt) => pt !== null) as CsvFile;
            setCsvData({ data: imagePoints });
            setFullCsvData(imagePoints);
          } else {
            // Use raw CSV data
            setCsvData({ data: rawData });
            setFullCsvData(rawData);
            if (hasTimestamp) {
              const tsRange = minMaxOf(rawData.map((r) => r.timestamp!));
              setMinTimestamp(tsRange?.min ?? 0);
              setMaxTimestamp(tsRange?.max ?? 0);

              // Initialize time ranges based on CSV timestamps
              const initialRanges: {
                [day: number]: { start: string; end: string };
              } = {};
              const dayGroups: { [day: number]: number[] } = {};

              rawData.forEach(({ timestamp }) => {
                if (timestamp === undefined) return;
                const date = new Date(timestamp!);
                const day = date.getUTCDate();
                const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
                if (!dayGroups[day]) dayGroups[day] = [];
                dayGroups[day].push(minutes);
              });

              Object.keys(dayGroups).forEach((dayStr) => {
                const day = parseInt(dayStr);
                const range = minMaxOf(dayGroups[day]);
                initialRanges[day] = {
                  start: minutesToTime(range?.min ?? 0),
                  end: minutesToTime(range?.max ?? 1439),
                };
              });
              setTimeRanges(initialRanges);
            }
          }
        },
      });
    }

    if (file) {
      transformFile(file);
    }
  }, [file, mappingConfirmed]);

  // Update the time range for a given day.
  const updateTimeRange = (day: number, start: string, end: string) => {
    setTimeRanges((prev) => ({
      ...prev,
      [day]: { start, end },
    }));
  };

  // Helper: converts a "HH:mm" string to total minutes.
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Helper: converts total minutes to "HH:mm" string.
  const minutesToTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}`;
  };

  // Per-day minute bounds for the time-range filter, built in one pass.
  // Rendering used to rescan every row (with a Date alloc each) per day per
  // render, which is minutes of jank on 100k-image surveys.
  const dayTimeBounds = useMemo(() => {
    const bounds = new Map<number, { min: number; max: number }>();
    const source = fullCsvData || csvData?.data || [];
    for (const row of source) {
      if (row.timestamp === undefined) continue;
      const date = new Date(row.timestamp);
      const day = date.getUTCDate();
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      const b = bounds.get(day);
      if (!b) {
        bounds.set(day, { min: minutes, max: minutes });
      } else {
        if (minutes < b.min) b.min = minutes;
        if (minutes > b.max) b.max = minutes;
      }
    }
    return bounds;
  }, [fullCsvData, csvData]);

  // Filter csvData rows by each day's selected time range.
  const applyTimeFilter = () => {
    if (!fullCsvData) return;
    const filtered = fullCsvData.filter((row) => {
      if (row.timestamp === undefined) return false;
      const date = new Date(row.timestamp!);
      const day = date.getUTCDate();
      const start = timeRanges[day]?.start || '00:00';
      const end = timeRanges[day]?.end || '23:59';
      const rowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      const startMinutes = timeToMinutes(start);
      const endMinutes = timeToMinutes(end);
      return rowMinutes >= startMinutes && rowMinutes <= endMinutes;
    });
    setCsvData({ data: filtered });
  };

  // Automatically re-filter when time ranges change
  useEffect(() => {
    if (
      associateByTimestamp ||
      (fullCsvData && fullCsvData.some((row) => row.timestamp))
    ) {
      applyTimeFilter();
    }
  }, [timeRanges, fullCsvData, associateByTimestamp]);

  // The model selector lives on the review step in wizard mode.
  const modelSelector = (
      <Form.Group>
        <Form.Label className='mb-0'>Model</Form.Label>
        <Form.Text
          className='d-block text-muted mt-0 mb-1'
          style={{ fontSize: 12 }}
        >
          Select the model you wish to use to guide annotation.
        </Form.Text>
        <Select
          className='text-black'
          value={model}
          options={[
            { label: 'ScoutBot', value: 'scoutbot' },
            {
              label: 'Elephant Detection Nadir',
              value: 'elephant-detection-nadir',
            },
            {
              label: 'Marine Animal Detector (MAD AI)',
              value: 'mad',
            },
            {
              label: 'OWL-D',
              value: 'owl-d',
            },
            {
              label: 'Manual (images may be processed later)',
              value: 'manual',
            },
          ]}
          onChange={(e) => {
            if (e) setModel(e);
          }}
          placeholder='Select a model'
        />
      </Form.Group>
  );

  // Common UI elements shared between modal and form versions, grouped into
  // wizard sections. Hidden sections stay mounted so their state survives
  // step navigation.
  return (
    <>
      <div className={sectionClass('images')}>
      <Form.Group>
        <Form.Label className='mb-0'>Files to Upload</Form.Label>
        <p className='text-muted mb-1' style={{ fontSize: 12 }}>
          Upload the survey files by selecting the entire folder you wish to
          upload.
        </p>
        <div
          className='p-2 mb-2 bg-white text-black'
          style={{ minHeight: '136px', overflow: 'auto' }}
        >
          {scannedFiles.length > 0 && (
            <code className='m-0 text-dark'>
              Folder name: {name}
              <br />
              Total files: {scannedFiles.length}
              <br />
              Image files: {imageFiles.length}
              <br />
              Image files size: {formatFileSize(totalImageSize)}
              <br />
              {loadingExistingImages ? (
                'Loading existing survey images...'
              ) : (
                <>
                  To upload: {toUploadFiles.length}
                  {toUploadFiles.length > 0 && (
                    <>
                      <br />
                      To upload size: {formatFileSize(toUploadSize)}
                    </>
                  )}
                </>
              )}
            </code>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Form.Group>
            <FileInput
              id='filepicker'
              webkitdirectory=''
              onFileChange={handleFileInputChange}
              onDirectoryHandle={setDirectoryHandle}
            >
              <p style={{ margin: 0 }}>
                {scannedFiles.length > 0
                  ? 'Change source folder'
                  : 'Select Folder'}
              </p>
            </FileInput>
          </Form.Group>
          {/* <div>
          <Form.Group>
            <Form.Check
              type="switch"
              id="custom-switch"
              label="Advanced Options"
              checked={advancedImageOptions}
              onChange={(x) => {
                setAdvancedImageOptions(x.target.checked);
                if (!x.target.checked) {
                  setUpload(true);
                  setIntegrityCheck(true);
                }
              }}
            />
          </Form.Group>
          {advancedImageOptions && (
              <Form.Group>
                <Form.Check
                  type="switch"
                  id="custom-switch"
                  label="Upload files to S3"
                  checked={upload}
                  onChange={(x) => {
                    setUpload(x.target.checked);
                  }}
                />
              </Form.Group>
          )}
        </div> */}
        </div>
      </Form.Group>
      {scanningEXIF && (
        <div className='mt-3 mb-0'>
          <p className='mb-0'>
            Scanning images for GPS data: {`${scanCount}/${scanTotal}`}
          </p>
        </div>
      )}
      {!scanningEXIF && failedFiles.length > 0 && (
        <Alert variant='warning' className='mt-3 mb-3'>
          <Alert.Heading>
            {failedFiles.length} file{failedFiles.length === 1 ? '' : 's'} failed
            to scan
          </Alert.Heading>
          <p className='mb-2' style={{ fontSize: '14px' }}>
            The following file{failedFiles.length === 1 ? '' : 's'} could not be
            processed (may be corrupt or unreadable). These files will be
            excluded from the upload, but you can continue with the remaining
            files.
          </p>
          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
              backgroundColor: '#f8f9fa',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            <ul className='mb-0' style={{ paddingLeft: '20px' }}>
              {failedFiles.map((failed, idx) => (
                <li key={idx} className='mb-1'>
                  <code style={{ fontSize: '11px' }}>{failed.path}</code>
                  {failed.error && (
                    <span className='ms-2' style={{ fontSize: '11px', color: '#dc3545' }}>
                      ({failed.error})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <Button
            variant='outline-dark'
            size='sm'
            className='mt-2'
            onClick={() => {
              const rows = failedFiles.map((failed) => ({
                originalPath: failed.path,
                reason: failed.error || 'Could not be read',
                category: 'scan-failed',
              }));
              downloadFailedImagesCsv(
                failedImagesCsvName(rows, project?.id ?? 'survey'),
                rows
              );
            }}
          >
            Download CSV
          </Button>
        </Alert>
      )}
      </div>
      <div className={sectionClass('georeference')}>
      {!scanningEXIF && Object.keys(exifData).length > 0 && imageFiles.length > 0 ? (
        <Form.Group className='mt-3 d-flex flex-column gap-2'>
          <div>
            <Form.Label className='mb-0'>
              {missingGpsData ? 'Missing GPS data' : 'GPS data found'}
            </Form.Label>
            <Form.Text className='d-block mb-0' style={{ fontSize: '12px' }}>
              {missingGpsData
                ? 'Some images do not have GPS data. Please upload the gpx or csv file containing the GPS data for all images.'
                : 'The selected images have GPS data. Would you like to upload a separate file containing the GPS data for all images?'}
            </Form.Text>
            <Form.Text className='d-block mb-0' style={{ fontSize: '12px' }}>
              Your CSV file should have the following columns (their headings
              may be different):
              <ul className='mb-0'>
                <li>timestamp and/or filepath</li>
                <li>lat</li>
                <li>lng</li>
                <li>alt</li>
              </ul>
            </Form.Text>
            <Form.Text className='d-block mb-0' style={{ fontSize: '12px' }}>
              If your data contains file paths instead of timestamps, the format
              should be:{' '}
              <code className='text-primary' style={{ fontSize: '14px' }}>
                {imageFiles[0].webkitRelativePath}
              </code>
            </Form.Text>
          </div>
          <div className='d-flex gap-2 align-items-center'>
            <FileInput
              id='gps-metadata-file'
              fileType='.csv,.gpx'
              onFileChange={(files) => setFile(files[0])}
            >
              <p className='mb-0'>Select GPS metadata file</p>
            </FileInput>
            {cognitoGroups.includes('sysadmin') && (
              <Button
                variant='outline-warning'
                size='sm'
                onClick={handleSkipGps}
              >
                Skip GPS selection (Admin)
              </Button>
            )}
          </div>
        </Form.Group>
      ) : null}
      {headerFields && !mappingConfirmed && (
        <Form.Group className='mt-3'>
          <Form.Label className='mb-0'>Confirm File Structure</Form.Label>
          <p className='text-muted mb-1' style={{ fontSize: 12 }}>
            Select which columns from your file correspond to the following
            fields:
          </p>
          <div
            className='d-flex flex-column gap-2 border border-dark p-2 shadow-sm'
            style={{ backgroundColor: '#697582' }}
          >
            <div className='d-flex flex-row gap-2 align-items-center'>
              <div style={{ flex: 0.5 }}>
                <Form.Label className='mb-0'>FilePath</Form.Label>
                <Select
                  options={[
                    { label: 'None', value: '' },
                    ...headerFields.map((f) => ({ label: f, value: f })),
                  ]}
                  value={
                    columnMapping.filepath
                      ? {
                        label: columnMapping.filepath,
                        value: columnMapping.filepath,
                      }
                      : { label: 'None', value: '' }
                  }
                  onChange={(opt) =>
                    setColumnMapping({
                      ...columnMapping,
                      filepath: opt ? opt.value : undefined,
                    })
                  }
                  placeholder='Select FilePath column'
                  className='text-black'
                />
              </div>
              <p
                className='mb-0'
                style={{ width: '50px', textAlign: 'center' }}
              >
                or
              </p>
              <div style={{ flex: 0.5 }}>
                <Form.Label className='mb-0'>Timestamp</Form.Label>
                <Select
                  options={[
                    { label: 'None', value: '' },
                    ...headerFields.map((f) => ({ label: f, value: f })),
                  ]}
                  value={
                    columnMapping.timestamp
                      ? {
                        label: columnMapping.timestamp,
                        value: columnMapping.timestamp,
                      }
                      : { label: 'None', value: '' }
                  }
                  onChange={(opt) =>
                    setColumnMapping({
                      ...columnMapping,
                      timestamp: opt ? opt.value : undefined,
                    })
                  }
                  placeholder='Select Timestamp column'
                  className='text-black'
                />
              </div>
            </div>
            <div className='d-flex flex-row gap-2 align-items-start mt-2'>
              <div style={{ flex: 0.5 }}>
                <Form.Label className='mb-0'>Latitude</Form.Label>
                <Select
                  options={headerFields.map((f) => ({ label: f, value: f }))}
                  value={
                    columnMapping.lat
                      ? { label: columnMapping.lat, value: columnMapping.lat }
                      : null
                  }
                  onChange={(opt) => {
                    setUseUtm(false);
                    setColumnMapping({
                      ...columnMapping,
                      lat: opt ? opt.value : undefined,
                    });
                  }}
                  placeholder='Select Latitude column'
                  className='text-black'
                />
                <div className='mt-2'>
                  <Form.Label className='mb-0'>Longitude</Form.Label>
                  <Select
                    options={headerFields.map((f) => ({ label: f, value: f }))}
                    value={
                      columnMapping.lng
                        ? { label: columnMapping.lng, value: columnMapping.lng }
                        : null
                    }
                    onChange={(opt) => {
                      setUseUtm(false);
                      setColumnMapping({
                        ...columnMapping,
                        lng: opt ? opt.value : undefined,
                      });
                    }}
                    placeholder='Select Longitude column'
                    className='text-black'
                  />
                </div>
              </div>
              <p
                className='mb-0'
                style={{
                  width: '50px',
                  textAlign: 'center',
                  alignSelf: 'center',
                }}
              >
                or
              </p>
              <div style={{ flex: 0.5, alignSelf: 'center' }}>
                <Form.Label className='mb-0'>UTM</Form.Label>
                <Select
                  options={[
                    { label: 'None', value: '' },
                    ...headerFields.map((f) => ({ label: f, value: f })),
                  ]}
                  value={
                    utmColumn
                      ? { label: utmColumn, value: utmColumn }
                      : { label: 'None', value: '' }
                  }
                  onChange={(opt) => {
                    const val = opt && opt.value ? opt.value : undefined;
                    setUtmColumn(val);
                    setUseUtm(Boolean(val));
                  }}
                  placeholder='None'
                  className='text-black'
                />
              </div>
            </div>
            <div>
              <div className='d-flex flex-row gap-3 align-items-center'>
                <Form.Label className='mb-0'>Altitude (optional)</Form.Label>
                <div className='d-flex flex-row gap-1 align-items-center'>
                  <label className='me-2'>ft</label>
                  <Form.Check
                    type='switch'
                    id='altitude-in-meters'
                    checked={altitudeInMeters}
                    onChange={(e) => setAltitudeInMeters(e.target.checked)}
                  />
                  <label>m</label>
                </div>
              </div>
              <div className='d-flex flex-row gap-2 align-items-center'>
                <Select
                  options={[
                    { label: 'None', value: '' },
                    ...headerFields.map((f) => ({ label: f, value: f })),
                  ]}
                  value={
                    columnMapping.alt
                      ? { label: columnMapping.alt, value: columnMapping.alt }
                      : { label: 'None', value: '' }
                  }
                  onChange={(opt) =>
                    setColumnMapping({
                      ...columnMapping,
                      alt: opt && opt.value ? opt.value : undefined,
                    })
                  }
                  placeholder='Select Altitude column'
                  className='text-black flex-grow-1'
                />
                <Select
                  options={altitudeTypeOptions}
                  value={altitudeType}
                  onChange={(opt) =>
                    setAltitudeType(opt ?? { label: 'EGM96', value: 'egm96' })
                  }
                  placeholder='Select Altitude Type'
                  className='text-black'
                />
              </div>
            </div>
          </div>
          <Button
            variant='primary'
            className='mt-2'
            onClick={handleConfirmMapping}
          >
            Confirm File Structure
          </Button>
        </Form.Group>
      )}
      {csvData && (
        <>
          {stepVisited('georeference') && (
            <GPSSubset
              gpsData={csvData.data}
              imageFiles={imageFiles}
              onFilter={(filteredData) => {
                setCsvData((prevData) => ({ ...prevData, data: filteredData }));
              }}
              onShapefileParsed={onShapefileParsed}
              existingImages={existingImagePoints}
            />
          )}
          <div className='mt-2 mb-2'>
            <strong>Images to upload:</strong>{' '}
            {
              csvData.data.filter(
                (point) =>
                  Number.isFinite(point.lat) && Number.isFinite(point.lng)
              ).length
            }
          </div>
          {(associateByTimestamp ||
            (csvData &&
              fullCsvData &&
              fullCsvData.some((row) => row.timestamp))) && (
              <Form.Group>
                <Form.Label className='mb-0'>
                  Filter Data by Time Range (Optional)
                </Form.Label>
                <Form.Text
                  className='d-block mb-1 mt-0'
                  style={{ fontSize: '12px' }}
                >
                  Select the effective time range for each day. The default range
                  is the earliest and latest timestamp recorded for that day.
                </Form.Text>
                <Form.Text
                  className='d-block mb-1'
                  style={{ fontSize: '12px', fontStyle: 'italic' }}
                >
                  All times shown in UTC.
                </Form.Text>
                <div className='d-flex flex-column gap-2'>
                  {Array.from(dayTimeBounds.keys())
                    .sort((a: number, b: number) => a - b)
                    .map((day: number) => {
                      const data = fullCsvData || csvData.data;
                      const dayRange = dayTimeBounds.get(day) ?? {
                        min: 0,
                        max: 1439,
                      };
                      const startMinutes = timeToMinutes(
                        timeRanges[day]?.start || minutesToTime(dayRange.min)
                      );
                      const endMinutes = timeToMinutes(
                        timeRanges[day]?.end || minutesToTime(dayRange.max)
                      );

                      const handleStartTimeChange = (timeStr: string) => {
                        const newStartMinutes = timeToMinutes(timeStr);
                        if (newStartMinutes <= endMinutes) {
                          updateTimeRange(
                            day,
                            timeStr,
                            timeRanges[day]?.end || minutesToTime(dayRange.max)
                          );
                        }
                      };

                      const handleEndTimeChange = (timeStr: string) => {
                        const newEndMinutes = timeToMinutes(timeStr);
                        if (newEndMinutes >= startMinutes) {
                          updateTimeRange(
                            day,
                            timeRanges[day]?.start || minutesToTime(dayRange.min),
                            timeStr
                          );
                        }
                      };

                      return (
                        <div
                          key={`day-${day}`}
                          className='d-flex flex-column gap-2 mt-2'
                        >
                          <span className='fw-bold'>
                            {new Date(data[0].timestamp!).toLocaleDateString()}
                          </span>
                          <div className='d-flex align-items-center gap-2'>
                            <label className='mb-0'>Start:</label>
                            <input
                              type='time'
                              className='form-control'
                              style={{ width: '120px' }}
                              value={minutesToTime(startMinutes)}
                              onChange={(e) =>
                                handleStartTimeChange(e.target.value)
                              }
                            />
                            <label className='mb-0'>End:</label>
                            <input
                              type='time'
                              className='form-control'
                              style={{ width: '120px' }}
                              value={minutesToTime(endMinutes)}
                              onChange={(e) =>
                                handleEndTimeChange(e.target.value)
                              }
                            />
                            <div className='flex-grow-1'>
                              <Slider
                                range
                                min={dayRange.min}
                                max={dayRange.max}
                                value={[startMinutes, endMinutes]}
                                onChange={(vals) => {
                                  if (Array.isArray(vals)) {
                                    const [s, e] = vals as [number, number];
                                    updateTimeRange(
                                      day,
                                      minutesToTime(s),
                                      minutesToTime(e)
                                    );
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </Form.Group>
            )}
          <div className='mt-3'>
            {invalidGpsFiles.length > 0 && (() => {
              const sample = invalidGpsFiles.slice(0, 5);
              const plural = invalidGpsFiles.length === 1 ? '' : 's';
              const examplePlural = sample.length === 1 ? '' : 's';
              return (
                <div
                  className={`alert ${
                    skipImagesWithoutGps ? 'alert-warning' : 'alert-danger'
                  } mb-2`}
                >
                  <div>
                    Missing GPS coordinates for {invalidGpsFiles.length} image
                    {plural}. Example{examplePlural}: {sample.join(', ')}
                  </div>
                  <Form.Check
                    type='checkbox'
                    id='skip-images-without-gps'
                    className='mt-2'
                    label={`Skip ${invalidGpsFiles.length} image${plural} without GPS data and continue`}
                    checked={skipImagesWithoutGps}
                    onChange={(e) =>
                      setSkipImagesWithoutGps(e.target.checked)
                    }
                  />
                </div>
              );
            })()}
            {(invalidGpsFiles.length === 0 || skipImagesWithoutGps) && (() => {
              let message = '';
              const hasTimestampData =
                csvData &&
                fullCsvData &&
                fullCsvData.some((row) => row.timestamp);
              if (associateByTimestamp || hasTimestampData) {
                const csvRange = minMaxOf(
                  csvData.data.map((row) => row.timestamp || 0)
                );
                const csvMin = csvRange?.min ?? 0;
                const csvMax = csvRange?.max ?? 0;
                if (csvRange) {
                  const formatTimestamp = (timestamp: number) =>
                    new Date(timestamp).toLocaleString(undefined, {
                      timeZone: 'UTC',
                    }) + ' UTC';
                  if (csvMin < minTimestamp || csvMax > maxTimestamp) {
                    message = `Timestamp mismatch: CSV timestamps (${formatTimestamp(
                      csvMin
                    )} - ${formatTimestamp(
                      csvMax
                    )}) are outside the image timestamps range.`;
                  } else {
                    message = `Timestamp range valid: CSV timestamps (${formatTimestamp(
                      csvMin
                    )} - ${formatTimestamp(
                      csvMax
                    )}) are within the image timestamps range.`;
                  }
                }
              } else {
                const total = filteredImageFiles.length;
                if (total > 0) {
                  const matched = filteredImageFiles.filter((file) =>
                    csvIndex.byFilepath.has(
                      file.webkitRelativePath.toLowerCase()
                    )
                  ).length;
                  const percent = Math.round((matched / total) * 100);
                  message = `${percent}% of image files have corresponding CSV file paths.`;
                } else {
                  message = `No image files available for CSV file path matching.`;
                }
              }
              const hasData = csvData.data.length > 0;
              const alertClass = hasData ? 'alert-info' : 'alert-danger';
              const displayMessage = hasData
                ? message
                : 'No matching GPS data for selected images.';
              return (
                <div className={`alert ${alertClass} mb-0`}>
                  {displayMessage}
                </div>
              );
            })()}
          </div>
        </>
      )}
      </div>
      <div className={sectionClass('cameras')}>
      {csvData && (
        <>
          <Form.Group className='mt-3'>
            <Form.Label className='mb-0'>Camera Definition</Form.Label>
            <span
              className='text-muted d-block mb-1'
              style={{ fontSize: '12px' }}
            >
              Does your survey have only one camera or multiple cameras?
            </span>
            <LabeledToggleSwitch
              leftLabel='Single Camera'
              rightLabel='Multiple Cameras'
              checked={multipleCameras}
              onChange={(e) => setMultipleCameras(e)}
            />
            {multipleCameras && (
              <>
                <FolderStructure
                  files={scannedFiles}
                  onCameraLevelChange={setCameraSelection}
                />
                {cameraSelection && (
                  <CameraOverlap
                    cameraSelection={cameraSelection}
                    overlaps={overlaps}
                    setOverlaps={setOverlaps}
                  />
                )}
              </>
            )}
            {/* Folder -> existing camera mapping (only when existing cameras
                are available and folder names don't already match them) */}
            {multipleCameras &&
              cameraSelection &&
              cameraSelection[1].length > 0 &&
              existingCameraNames.length > 0 &&
              !loadingExistingCameras && (
                <Form.Group className='mt-3'>
                  <Form.Check
                    type='checkbox'
                    id='use-folder-camera-mapping'
                    label='Map folder names to existing cameras'
                    checked={useFolderCameraMapping}
                    onChange={(e) => {
                      setUseFolderCameraMapping(e.target.checked);
                      if (!e.target.checked) setFolderCameraMapping({});
                    }}
                  />
                  <span
                    className='text-muted d-block mb-2'
                    style={{ fontSize: '12px' }}
                  >
                    Enable when the uploaded folder names differ from the
                    camera names already on this survey.
                  </span>
                  {useFolderCameraMapping && (
                    <div className='mt-1'>
                      {cameraSelection[1].map((folderName) => (
                        <div
                          className='d-flex align-items-center mb-2'
                          key={folderName}
                        >
                          <div
                            className='text-truncate'
                            style={{ minWidth: 180 }}
                            title={folderName}
                          >
                            {folderName}
                          </div>
                          <span className='mx-2'>→</span>
                          <Form.Select
                            aria-label={`Camera for folder ${folderName}`}
                            value={folderCameraMapping[folderName] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFolderCameraMapping((m) => {
                                const next = { ...m };
                                if (val) next[folderName] = val;
                                else delete next[folderName];
                                return next;
                              });
                            }}
                          >
                            <option value=''>Select camera…</option>
                            {existingCameraNames.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </Form.Select>
                        </div>
                      ))}
                    </div>
                  )}
                </Form.Group>
              )}
            {/* Existing vs New camera notice */}
            {(() => {
              if (!cameraSelection) return null;
              const currentNames = cameraSelection[1];
              const resolve = (n: string) =>
                (useFolderCameraMapping && folderCameraMapping[n]) || n;
              const existingSet = new Set(existingCameraNames);
              const matched = currentNames
                .map(resolve)
                .filter((n) => existingSet.has(n));
              const newOnes = currentNames
                .filter((n) => !folderCameraMapping[n])
                .filter((n) => !existingSet.has(n));
              const hasAny = currentNames.length > 0;
              if (!hasAny || loadingExistingCameras) return null;
              return (
                <div className='mt-2'>
                  {matched.length > 0 && (
                    <div className='alert alert-info mb-2'>
                      These cameras already exist and will be linked by name:{' '}
                      {Array.from(new Set(matched)).join(', ')}
                    </div>
                  )}
                  {matched.length === 0 && newOnes.length === 0 && (
                    <div className='alert alert-warning mb-2'>
                      No cameras detected from folder structure.
                    </div>
                  )}
                </div>
              );
            })()}
            {(() => {
              if (!cameraSelection) return null;
              const names = (cameraSelection || [
                'Survey Level',
                ['Survey Camera'],
              ])[1];
              const existingSet = new Set(existingCameraNames);
              // Folders mapped to existing cameras don't need spec input.
              const onlyNew = names.filter(
                (n) =>
                  !(useFolderCameraMapping && folderCameraMapping[n]) &&
                  !existingSet.has(n)
              );
              if (onlyNew.length === 0) return null;
              return (
                <CameraSpecification
                  cameraSelection={[
                    (cameraSelection || ['Survey Level', ['Survey Camera']])[0],
                    onlyNew,
                  ]}
                  cameraSpecs={cameraSpecs}
                  setCameraSpecs={setCameraSpecs}
                />
              );
            })()}
          </Form.Group>
        </>
      )}
      {filteredImageFiles.length > 0 && csvData && (
        <OrientationReview
          cameraGroups={orientationCameraGroups}
          rotations={cameraRotations}
          setRotations={setCameraRotations}
        />
      )}
      </div>
      <div className={sectionClass('review')}>
      {modelSelector}
      {filteredImageFiles.length > 0 && csvData && stepVisited('review') && (
        <ImageMaskEditor setMasks={setMasks} />
      )}
      {csvData && (
        <div className='border border-dark p-2 mt-2'>
          <strong>Summary</strong>
          <ul className='mb-0 mt-1' style={{ fontSize: 14 }}>
            {(summaryDetails ?? []).map(({ label, value }) => (
              <li key={label}>
                <strong>{label}:</strong> {value}
              </li>
            ))}
            {name && (
              <li>
                <strong>Source folder:</strong> {name}
              </li>
            )}
            <li>
              <strong>Images to upload:</strong> {toUploadFiles.length} (
              {formatFileSize(toUploadSize)})
            </li>
            <li>
              <strong>Model:</strong> {model.label}
            </li>
            <li>
              <strong>Location data:</strong>{' '}
              {file
                ? `${file.name} (${associateByTimestamp ? 'matched by timestamp' : 'matched by file path'})`
                : associateByTimestamp
                  ? 'Image EXIF metadata'
                  : 'No external location file'}
            </li>
            {file && mappingConfirmed && headerFields && (
              <li>
                <strong>Coordinate fields:</strong>{' '}
                {useUtm
                  ? `UTM (${utmColumn})`
                  : `${columnMapping.lat}, ${columnMapping.lng}`}
                {columnMapping.alt
                  ? `; altitude ${columnMapping.alt} (${altitudeInMeters ? 'm' : 'ft'}, ${altitudeType.label})`
                  : ''}
              </li>
            )}
            <li>
              <strong>Camera setup:</strong>{' '}
              {multipleCameras ? 'Multiple cameras' : 'Single camera'}
            </li>
            <li>
              <strong>Cameras:</strong>{' '}
              {orientationCameraGroups.length > 0
                ? Array.from(
                    new Set(
                      orientationCameraGroups.map((group) => group.cameraName)
                    )
                  ).join(', ')
                : 'None detected'}
            </li>
            <li>
              <strong>Camera orientations:</strong>{' '}
              {orientationCameraGroups.length > 0
                ? orientationCameraGroups
                    .map((group) => {
                      const rotation = orientationCorrectionFor(
                        cameraRotations,
                        group.cameraName,
                        group.orientationGroup
                      );
                      const shape =
                        group.orientationGroup === 'portrait'
                          ? 'portrait'
                          : 'landscape';
                      return `${group.cameraName} ${shape} - ${rotation === 0 ? '0\u00B0 (original)' : `${rotation}\u00B0 CCW`}`;
                    })
                    .join('; ')
                : 'None detected'}
            </li>
            {Object.keys(cameraSpecs).length > 0 && (
              <li>
                <strong>Camera specifications:</strong>{' '}
                {Object.entries(cameraSpecs)
                  .map(
                    ([cameraName, spec]) =>
                      `${cameraName} - ${spec.focalLengthMm} mm focal length, ${spec.sensorWidthMm} mm sensor, ${spec.tiltDegrees}\u00B0 tilt`
                  )
                  .join('; ')}
              </li>
            )}
            {overlaps.length > 0 && (
              <li>
                <strong>Camera overlaps:</strong>{' '}
                {overlaps
                  .map(({ cameraA, cameraB }) => `${cameraA} / ${cameraB}`)
                  .join('; ')}
              </li>
            )}
            {masks.length > 0 && (
              <li>
                <strong>Masks:</strong> {masks.length}
              </li>
            )}
          </ul>
        </div>
      )}
      </div>
    </>
  );
}

// Form-compatible version that can be integrated into another form
export function FilesUploadForm(props: FilesUploadFormProps) {
  return <FileUploadCore {...props} />;
}

export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

// Wizard steps for the add-files / resume modal (no survey-details step).
const MODAL_WIZARD_STEPS = [
  'Images',
  'Location Data',
  'Cameras',
  'Review & Submit',
];
const MODAL_CORE_STEPS: UploadWizardStep[] = [
  'images',
  'georeference',
  'cameras',
  'review',
];

// Original modal version
export default function FilesUploadComponent({
  show,
  handleClose,
  project,
  fromStaleUpload,
}: FilesUploadComponentProps) {
  const { client } = useContext(GlobalContext)!;
  const [uploadSubmitFn, setUploadSubmitFn] = useState<
    ((projectId: string, fromStaleUpload?: boolean) => Promise<void>) | null
  >(null);
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [furthestIndex, setFurthestIndex] = useState(0);
  const [imagesReady, setImagesReady] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);

  const stepReadyToAdvance = (index: number): boolean => {
    switch (index) {
      case 0:
        return imagesReady;
      case 1:
        return gpsReady;
      default:
        return true;
    }
  };

  // Modal version needs to handle its own submit
  const handleModalSubmit = async () => {
    if (!uploadSubmitFn || !project?.id) return;
    setIsSubmitting(true);
    try {
      try {
        await client.models.Project.update({
          id: project.id,
          status: 'uploading',
        });
        try {
          await client.mutations.updateProjectMemberships({
            projectId: project.id,
          });
        } catch {
          /* noop: membership ping best-effort */
        }
      } catch {
        /* noop: status update will be enforced by UploadManager */
      }

      handleClose();

      await uploadSubmitFn(project.id, fromStaleUpload);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size='xl'
      backdrop='static'
      keyboard={false}
    >
      <Modal.Header>
        <Modal.Title>
          {fromStaleUpload ? 'Resume upload: ' : 'Add files: '}
          {project?.name}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <StepIndicator
            steps={MODAL_WIZARD_STEPS}
            currentIndex={stepIndex}
            furthestIndex={furthestIndex}
            onSelect={setStepIndex}
          />
          {fromStaleUpload && (
            <p className='mb-2 text-warning'>
              This survey&apos;s upload is stale.
              <br />
              Complete the form to continue - only the remaining images will be
              uploaded.
            </p>
          )}
          <FileUploadCore
            project={project}
            setOnSubmit={setUploadSubmitFn}
            setReadyToSubmit={setReadyToSubmit}
            setGpsDataReady={setGpsReady}
            setImagesReady={setImagesReady}
            currentStep={MODAL_CORE_STEPS[stepIndex]}
            newProject={false}
          />
        </Form>
      </Modal.Body>
      <Modal.Footer>
        {stepIndex > 0 && (
          <Button
            variant='secondary'
            disabled={isSubmitting || isClosing}
            onClick={() => setStepIndex(stepIndex - 1)}
          >
            Back
          </Button>
        )}
        {stepIndex < MODAL_WIZARD_STEPS.length - 1 ? (
          <Button
            variant='primary'
            disabled={!stepReadyToAdvance(stepIndex)}
            onClick={() => {
              const next = stepIndex + 1;
              setStepIndex(next);
              setFurthestIndex((prev) => Math.max(prev, next));
            }}
          >
            Next
          </Button>
        ) : (
          <Button
            variant='primary'
            disabled={!readyToSubmit || isSubmitting || isClosing}
            onClick={handleModalSubmit}
          >
            Submit
          </Button>
        )}
        <Button
          variant='dark'
          disabled={isSubmitting || isClosing}
          onClick={() => {
            setIsClosing(true);
            handleClose();
          }}
        >
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
