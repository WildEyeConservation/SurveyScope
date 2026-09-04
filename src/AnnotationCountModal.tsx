import React, { useEffect, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { Modal, Body, Header, Footer, Title } from './Modal';

import { client } from './stores/appClient';
import { fetchAllPaginatedResults } from './utils';
import MyTable from './Table';
import LabeledToggleSwitch from './LabeledToggleSwitch';
import { Schema } from './amplify/client-schema';

interface Props {
  show: boolean;
  handleClose: () => void;
  setId: string;
}

const AnnotationCountModal: React.FC<Props> = ({
  show,
  handleClose,
  setId,
}) => {
  const [annotations, setAnnotations] = useState<
    Schema['Annotation']['type'][]
  >([]);
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasFalseNegatives, setHasFalseNegatives] = useState(false);

  useEffect(() => {
    async function getAnnotationCounts() {
      setLoading(true);

      const result = await fetchAllPaginatedResults(
        client.models.Annotation.annotationsByAnnotationSetId,
        {
          setId: setId,
          selectionSet: ['id', 'category.name', 'objectId', 'source'] as const,
          limit: 10000,
        }
      );
      setAnnotations(result);

      setLoading(false);

      if (
        result.some((annotation) =>
          annotation.source.includes('false-negative')
        )
      ) {
        setHasFalseNegatives(true);
      }
    }

    if (setId && show) {
      getAnnotationCounts();
    }
  }, [setId, show]);

  //reduce to group by category
  const annotationByCategory = annotations.reduce((acc, annotation) => {
    const category = annotation.category?.name ?? 'Unknown';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(annotation);
    return acc;
  }, {} as { [category: string]: Schema['Annotation']['type'][] });

  const falseNegativesByCategory = annotations.reduce((acc, annotation) => {
    const category = annotation.category?.name ?? 'Unknown';
    if (!acc[category]) {
      acc[category] = 0;
    }
    if (annotation.source.includes('false-negative')) {
      acc[category]++;
    }
    return acc;
  }, {} as { [category: string]: number });

  const tableData = Object.entries(annotationByCategory).map(
    ([category, annotations]) => ({
      id: category,
      rowData: [
        category,
        primaryOnly
          ? annotations.filter(
            (annotation) => annotation.objectId === annotation.id
          ).length
          : annotations.length,
      ].concat(hasFalseNegatives ? [falseNegativesByCategory[category]] : []),
    })
  );

  return (
    <Modal show={show} onHide={handleClose} size='lg'>
      <Header>
        <Title>Annotation Set Details</Title>
      </Header>
      <Body>
        <div className='p-3'>
          {loading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <Spinner
                animation='border'
                variant='light'
                size='sm'
                className='me-2'
              />
              Fetching annotations...
            </div>
          ) : (
            <div className='d-flex flex-column gap-2 w-100'>
              <LabeledToggleSwitch
                className='mb-2'
                leftLabel='All annotations'
                rightLabel='Primary only'
                checked={primaryOnly}
                onChange={(checked) => {
                  setPrimaryOnly(checked);
                }}
              />
              <MyTable
                tableHeadings={[
                  { content: 'Label', style: { width: '33%' } },
                  {
                    content: primaryOnly ? 'Primary only' : 'All annotations',
                    style: { width: '33%' },
                  },
                ].concat(
                  hasFalseNegatives
                    ? [{ content: 'False Negatives', style: { width: '34%' } }]
                    : []
                )}
                tableData={tableData}
                emptyMessage='No annotations found'
              />
            </div>
          )}
        </div>
      </Body>
      <Footer>
        <Button variant='dark' onClick={handleClose}>
          Close
        </Button>
      </Footer>
    </Modal>
  );
};

export default AnnotationCountModal;
