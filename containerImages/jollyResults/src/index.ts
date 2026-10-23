import { SurveyAccumulator } from './compute.js';
import {
  ProgressReporter,
  commitResults,
  consumeByHash,
  findHashIndex,
  getProjectOrganizationId,
  queryByHash,
  readJobInput,
  readWorkerEnvironment,
} from './aws.js';
import type {
  AnnotationRecord,
  CameraRecord,
  ImageRecord,
  StratumRecord,
  TransectRecord,
} from './types.js';

let terminationRequested = false;
process.on('SIGTERM', () => {
  terminationRequested = true;
});

function assertRunning(): void {
  if (terminationRequested) {
    throw new Error('The worker received a termination request');
  }
}

async function main(): Promise<void> {
  const environment = readWorkerEnvironment();
  const job = readJobInput();
  const reporter = new ProgressReporter(environment, job);
  let commitStarted = false;

  try {
    await reporter.emit('RUNNING', 'STARTING', { force: true });
    const actualOrganizationId = await getProjectOrganizationId(
      environment.projectTableName,
      job.surveyId
    );
    if (actualOrganizationId !== job.organizationId) {
      throw new Error(
        'Survey organization changed after this job was authorized'
      );
    }

    const [
      cameraIndex,
      stratumIndex,
      transectIndex,
      imageIndex,
      annotationIndex,
    ] = await Promise.all([
      findHashIndex(environment.cameraTableName, 'projectId'),
      findHashIndex(environment.stratumTableName, 'projectId'),
      findHashIndex(environment.transectTableName, 'projectId'),
      findHashIndex(environment.imageTableName, 'projectId'),
      findHashIndex(environment.annotationTableName, 'setId'),
    ]);

    await reporter.emit('RUNNING', 'FETCHING_CONFIGURATION', {
      force: true,
    });
    const [cameras, strata, transects] = await Promise.all([
      queryByHash<CameraRecord>({
        tableName: environment.cameraTableName,
        indexName: cameraIndex,
        hashAttribute: 'projectId',
        hashValue: job.surveyId,
        fields: [
          'id',
          'focalLengthMm',
          'sensorWidthMm',
          'tiltDegrees',
        ],
      }),
      queryByHash<StratumRecord>({
        tableName: environment.stratumTableName,
        indexName: stratumIndex,
        hashAttribute: 'projectId',
        hashValue: job.surveyId,
        fields: [
          'id',
          'name',
          'area',
          'baselineLength',
          'offEffort',
          'coordinates',
        ],
      }),
      queryByHash<TransectRecord>({
        tableName: environment.transectTableName,
        indexName: transectIndex,
        hashAttribute: 'projectId',
        hashValue: job.surveyId,
        fields: ['id', 'stratumId'],
      }),
    ]);

    const accumulator = new SurveyAccumulator({
      surveyId: job.surveyId,
      annotationSetId: job.annotationSetId,
      organizationId: job.organizationId,
      categoryIds: job.categoryIds,
      cameras,
      strata,
      transects,
    });

    await consumeByHash<ImageRecord>(
      {
        tableName: environment.imageTableName,
        indexName: imageIndex,
        hashAttribute: 'projectId',
        hashValue: job.surveyId,
        fields: [
          'id',
          'transectId',
          'cameraId',
          'latitude',
          'longitude',
          'altitude_agl',
          'timestamp',
          'boundaryStatus',
        ],
      },
      async (pageImages) => {
        for (const image of pageImages) accumulator.addImage(image);
      },
      async (pages, items) => {
        assertRunning();
        await reporter.emit('RUNNING', 'FETCHING_IMAGES', {
          progress: { pages, items },
        });
      }
    );
    await reporter.emit('RUNNING', 'FETCHING_IMAGES', {
      progress: { imagesProcessed: accumulator.validImageCount },
      force: true,
    });

    await consumeByHash<AnnotationRecord>(
      {
        tableName: environment.annotationTableName,
        indexName: annotationIndex,
        hashAttribute: 'setId',
        hashValue: job.annotationSetId,
        fields: ['id', 'objectId', 'imageId', 'categoryId'],
      },
      async (pageAnnotations) => {
        for (const annotation of pageAnnotations) {
          accumulator.addAnnotation(annotation);
        }
      },
      async (pages, items) => {
        assertRunning();
        await reporter.emit('RUNNING', 'FETCHING_ANNOTATIONS', {
          progress: { pages, items },
        });
      }
    );

    assertRunning();
    await reporter.emit('RUNNING', 'COMPUTING', { force: true });
    const output = accumulator.calculate();
    commitStarted = true;
    await commitResults({
      environment,
      job,
      reporter,
      results: output.results,
      validation: output.validation,
      warnings: output.warnings,
    });
    await reporter.emit('COMPLETED', 'COMPLETED', {
      progress: { resultRows: output.results.length },
      validation: output.validation,
      warnings: output.warnings,
      force: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    try {
      await reporter.emit(
        commitStarted ? 'ROLLING_BACK' : 'FAILED',
        commitStarted ? 'ROLLING_BACK' : 'FAILED',
        { error: message, force: true }
      );
    } catch (reportingError) {
      console.error(
        JSON.stringify({
          level: 'error',
          jobId: job.jobId,
          message: 'Failed to report worker error',
          error:
            reportingError instanceof Error
              ? reportingError.message
              : String(reportingError),
        })
      );
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Jolly Results worker failed',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  );
  process.exitCode = 1;
});
