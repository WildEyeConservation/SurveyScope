import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import {
  boundaryRecomputePending,
  loadSurveyArea,
  recomputeBoundaryStatus,
  saveSurveyArea,
} from '../utils/shapefileUtils';
import SurveyAreaEditor from './SurveyAreaEditor';
import { EMPTY_AREA, type SurveyArea } from './new-survey/surveyArea';
import { EMPTY_NETWORK } from './strataNetwork';
import {
  initialNetwork,
  layoutOf,
  loadProjectStrata,
  parseNetwork,
  sameStrata,
  saveNetwork,
  saveStrataRows,
  strataReshaped,
  type StrataClient,
} from './strataStore';
import {
  runSurveySave,
  surveySaveSettled,
  useSurveySaving,
} from './surveySaves';
import {
  carryStrata,
  clearJollyResults,
  loadStrata,
  type NamedStratum,
  type SavedStratum,
} from './transectStrata';

type DefineStrataProps = { projectId: string; organizationId: string };

type Saved = {
  area: SurveyArea;
  strata: SavedStratum[];
  // The edited list as first shown, to tell edits from layout differences.
  baseline: NamedStratum[];
};

const POLL_MS = 3000;

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export default function DefineStrata({
  projectId,
  organizationId,
}: DefineStrataProps) {
  const { client, showModal } = useContext(GlobalContext)!;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [area, setArea] = useState<SurveyArea>(EMPTY_AREA);
  const [named, setNamed] = useState<NamedStratum[]>([]);
  const [legacyReset, setLegacyReset] = useState(false);
  const [pending, setPending] = useState(false);
  const surveySaving = useSurveySaving(projectId);
  const strataClient = client as unknown as StrataClient;
  // Survives a failed save so the retry still starts the recompute.
  const recomputeDueRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        await surveySaveSettled(projectId);
        if (signal.aborted) return;
        const [loadedArea, strata, project] = await Promise.all([
          loadSurveyArea(client, projectId, signal),
          loadStrata(client, projectId, signal),
          loadProjectStrata(strataClient, projectId, signal),
        ]);
        if (signal.aborted) return;
        const network = initialNetwork(
          parseNetwork(project.strataNetwork),
          strata,
        );
        const next = { ...loadedArea, network };
        const carried = carryStrata(layoutOf(next, strata).sections, strata);
        setArea(next);
        setSaved({
          area: next,
          strata,
          baseline: carried,
        });
        setNamed(carried);
        setPending(boundaryRecomputePending(project));
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to load strata:', err);
        setLoadError(true);
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [client, strataClient, projectId]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const project = await loadProjectStrata(
          strataClient,
          projectId,
          controller.signal,
        );
        if (!controller.signal.aborted && !boundaryRecomputePending(project))
          setPending(false);
      } catch (err) {
        if (!controller.signal.aborted)
          console.error('Failed to check the strata status:', err);
      }
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [strataClient, projectId, pending]);

  const legacy = useMemo(() => saved?.strata ?? [], [saved]);
  const layout = useMemo(() => layoutOf(area, legacy), [area, legacy]);

  const handleAreaChange = (next: SurveyArea) => {
    let area = next;
    if (
      next.network === null &&
      !sameJson(next.boundary, saved?.area.boundary)
    ) {
      area = { ...next, network: EMPTY_NETWORK };
      setLegacyReset(true);
    }
    setArea(area);
    setNamed((prev) => carryStrata(layoutOf(area, legacy).sections, prev));
  };

  const trimmed = named.map((st) => st.name.trim());
  const invalid = trimmed.map(
    (name, i) => !name || trimmed.indexOf(name) !== i,
  );

  const areaChanged =
    !!saved &&
    (!sameJson(area.boundary, saved.area.boundary) ||
      !sameJson(area.exclusions, saved.area.exclusions));
  const networkChanged = !!saved && !sameJson(area.network, saved.area.network);
  const strataChanged = !!saved && !sameStrata(named, saved.baseline);
  const dirty = areaChanged || networkChanged || strataChanged;
  const canSave =
    !!saved &&
    !!area.boundary &&
    dirty &&
    named.length > 0 &&
    !invalid.some(Boolean);

  const handleSave = async () => {
    if (!saved) return;
    setSaving(true);
    setSaveError(null);
    try {
      await runSurveySave(projectId, async () => {
        if (areaChanged) {
          await saveSurveyArea(client, projectId, area, organizationId);
        }
        if (areaChanged || strataReshaped(named, saved.strata))
          recomputeDueRef.current = true;
        const strata = await saveStrataRows(
          strataClient,
          projectId,
          organizationId,
          named,
          saved.strata,
        );
        if (networkChanged && area.network) {
          await saveNetwork(strataClient, projectId, area.network);
        }
        if (recomputeDueRef.current) {
          await clearJollyResults(client, projectId);
          await recomputeBoundaryStatus(client, projectId);
          recomputeDueRef.current = false;
          setPending(true);
        }
        const savedNamed = strata.map((st, i) => ({
          ...st,
          coords: named[i].coords,
        }));
        setSaved({ area, strata, baseline: savedNamed });
        setNamed(savedNamed);
        setLegacyReset(false);
      });
    } catch (err) {
      console.error('Failed to save strata:', err);
      // Rows created before the failure are replaced on the next attempt.
      const strata = await loadStrata(client, projectId).catch(() => null);
      if (strata) setSaved((prev) => prev && { ...prev, strata });
      setSaveError(
        'The survey area and strata could not be saved. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const status = (
    <>
      {pending && (
        <span
          className='flex items-center gap-2 text-muted-foreground'
          style={{ fontSize: 12 }}
        >
          <Spinner animation='border' size='sm' />
          Moving images and transects into the saved strata
        </span>
      )}
      {legacyReset && (
        <Alert variant='warning' className='mb-0 p-2' style={{ fontSize: 12 }}>
          These strata were saved before strata lines were kept, so they cannot
          follow the new boundary. The area is one stratum again; redraw the
          lines to divide it.
        </Alert>
      )}
    </>
  );

  return (
    <>
      <div className='flex flex-col gap-4 p-4'>
        <span className='text-muted-foreground' style={{ fontSize: '14px' }}>
          Upload or draw the survey boundary and any exclusion zones, then
          divide the area into strata. Exclusion zones are deducted from the
          stratum areas when computing results.
        </span>
        {loading ? (
          <div className='flex items-center justify-center'>
            <Spinner animation='border' />
            <span className='ms-2'>
              {surveySaving
                ? 'Waiting for the last save to finish'
                : 'Loading survey area'}
            </span>
          </div>
        ) : loadError ? (
          <Alert variant='danger' className='mb-0'>
            The survey area could not be loaded. Close and reopen this window to
            try again.
          </Alert>
        ) : (
          <SurveyAreaEditor
            value={area}
            onChange={handleAreaChange}
            locked={saving}
            strata={{
              sections: layout.sections,
              names: named.map((st) => st.name),
              onNameChange: (index, name) =>
                setNamed((prev) =>
                  prev.map((st, i) => (i === index ? { ...st, name } : st)),
                ),
              invalid,
              dangling: layout.dangling,
              status,
            }}
          />
        )}
        {saveError && (
          <Alert variant='danger' className='mb-0 p-2'>
            {saveError}
          </Alert>
        )}
        {saving && (
          <div className='flex items-center justify-center'>
            <Spinner animation='border' size='sm' />
            <span className='ms-2'>
              Saving, please do not close this window
            </span>
          </div>
        )}
      </div>
      <Footer>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={!canSave || saving || surveySaving}
        >
          Save
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={saving}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
