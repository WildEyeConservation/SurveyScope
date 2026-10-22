import { useState, useEffect, useContext } from 'react';
import { GlobalContext } from '../Context';
import {
  clearAreaDerivedResults,
  loadSurveyArea,
  recomputeBoundaryStatus,
  saveSurveyArea,
} from '../utils/shapefileUtils';
import { Spinner, Button } from 'react-bootstrap';
import { Footer } from '../Modal';
import SurveyAreaEditor from './SurveyAreaEditor';
import SurveyAreaMargin from './SurveyAreaMargin';
import { EMPTY_AREA, type SurveyArea } from './new-survey/surveyArea';

export default function EditShapeFile({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { client, showModal } = useContext(GlobalContext)!;
  const [area, setArea] = useState<SurveyArea>(EMPTY_AREA);
  const [marginInput, setMarginInput] = useState('0');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    loadSurveyArea(client, projectId, signal)
      .then((loaded) => {
        if (signal.aborted) return;
        setArea(loaded);
        setMarginInput(String(loaded.marginM ?? 0));
      })
      .catch((err) => {
        if (signal.aborted) return;
        console.error('Failed to load shapefile/exclusions:', err);
        setLoadFailed(true);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, projectId]);

  const saveShapefile = async () => {
    if (!area.boundary) return;
    setSaving(true);
    try {
      await saveSurveyArea(
        client,
        projectId,
        area,
        organizationId,
        Math.max(0, Number(marginInput) || 0)
      );
      await clearAreaDerivedResults(client, projectId);
      await recomputeBoundaryStatus(client, projectId);
      alert(
        'You have successfully updated the shapefile. Please review your strata and transects on the next tab and save your work whether you made any changes or not.'
      );
    } catch (err) {
      console.error('Failed to save shapefile:', err);
      alert('The shapefile could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className='d-flex flex-column gap-3 p-3'>
        <span className='text-muted' style={{ fontSize: '14px' }}>
          Upload or draw the survey boundary and any exclusion zones. Exclusion
          zones are deducted from the total area when computing results. Press
          "Save Shapefile" at the bottom of the page to save.
        </span>
        {loading ? (
          <div className='d-flex justify-content-center align-items-center'>
            <Spinner animation='border' />
            <span className='ms-2'>Loading shapefile</span>
          </div>
        ) : loadFailed ? (
          <div className='alert alert-danger mb-0'>
            The saved shapefile could not be loaded. Close and reopen this
            window to try again.
          </div>
        ) : (
          <SurveyAreaEditor value={area} onChange={setArea} locked={saving}>
            {area.boundary && (
              <SurveyAreaMargin
                value={marginInput}
                onChange={setMarginInput}
                disabled={saving}
              />
            )}
          </SurveyAreaEditor>
        )}
        {saving && (
          <div className='d-flex justify-content-center align-items-center'>
            <Spinner animation='border' />
            <span className='ms-2'>
              Saving, please do not close this window
            </span>
          </div>
        )}
      </div>
      <Footer>
        <Button
          variant='primary'
          onClick={saveShapefile}
          disabled={!area.boundary || loading || loadFailed || saving}
        >
          Save Shapefile
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
