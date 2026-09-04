import { Button, Form } from 'react-bootstrap';
import { Modal, Header, Title, Body, Footer } from '../Modal';
import { useState, useEffect } from 'react';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import Tooltip from 'react-bootstrap/Tooltip';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';

type TestType = 'random' | 'interval';

export default function ConfigModal({
  show,
  survey,
}: {
  show: boolean;
  survey: { id: string; name: string };
}) {
  const [testInterval, setTestInterval] = useState<number>(0);
  const [testType, setTestType] = useState<TestType>('interval');
  const [testChance, setTestChance] = useState<number>(0);
  const [deadzone, setDeadzone] = useState<number>(0);
  const [confirmation, setConfirmation] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  useEffect(() => {
    const fetchTestConfig = async () => {
      const { data: config } = await client.models.ProjectTestConfig.get({
        projectId: survey.id,
      });

      if (!config) {
        return;
      }

      setTestType(config.testType as TestType);

      if (config.testType === 'interval') {
        setTestInterval(config.interval!);
      } else {
        setTestChance(config.random!);
        setDeadzone(config.deadzone!);
      }

      setConfirmation(config.postTestConfirmation!);
    };
    if (show) {
      fetchTestConfig();
    } else {
      setTestInterval(0);
      setDeadzone(0);
      setTestChance(0);
      setConfirmation(false);
    }
  }, [show]);

  async function handleSave() {
    if (testType === 'interval' && testInterval < 10) {
      alert('Test interval must be greater than 10');
      return;
    }

    if (testType === 'random') {
      if (testChance < 0 || testChance > 100) {
        alert('Test chance must be between 0 and 100');
        return;
      }
      if (deadzone < 10) {
        alert('Deadzone must be greater than 10');
        return;
      }
    }

    setSaving(true);

    await client.models.ProjectTestConfig.update({
      projectId: survey.id,
      testType: testType,
      random: testType === 'random' ? testChance : undefined,
      deadzone: testType === 'random' ? deadzone : undefined,
      interval: testType === 'interval' ? testInterval : undefined,
      postTestConfirmation: confirmation,
    });

    setSaving(false);
    showModal(null);
  }

  return (
    <Modal show={show} strict={true} size='lg'>
      <Header>
        <Title>Configure {survey.name} Tests</Title>
      </Header>
      <Body>
        <Form className='p-3'>
          <Form.Group className='mb-2'>
            <Form.Label>Test type</Form.Label>
            <Form.Select
              value={testType}
              onChange={(e) =>
                setTestType(e.target.value as 'random' | 'interval')
              }
            >
              <option value='random'>Random</option>
              <option value='interval'>Interval</option>
            </Form.Select>
          </Form.Group>
          {testType === 'interval' && (
            <Form.Group className='mb-2'>
              <OverlayTrigger
                placement='right-end'
                overlay={
                  <Tooltip>
                    User will be tested if they haven't consecutively annotated
                    in the amount of jobs specified. <br /> Note: Navigating to
                    and annotating a previous job will not reset the counter.
                  </Tooltip>
                }
                trigger={['hover', 'focus']}
              >
                <Form.Label>Test after * unannotated jobs</Form.Label>
              </OverlayTrigger>
              <Form.Control
                type='number'
                value={testInterval}
                onChange={(e) =>
                  setTestInterval(parseInt(e.target.value || '10'))
                }
                min={10}
              />
            </Form.Group>
          )}
          {testType === 'random' && (
            <Form.Group className='mb-2'>
              <OverlayTrigger
                placement='right-end'
                overlay={
                  <Tooltip>
                    After the amount of jobs specified in deadzone, each of the
                    following jobs will have the specified probability of being
                    a test.
                  </Tooltip>
                }
                trigger={['hover', 'focus']}
              >
                <Form.Label>Deadzone</Form.Label>
              </OverlayTrigger>
              <Form.Control
                type='number'
                value={deadzone}
                onChange={(e) => setDeadzone(parseInt(e.target.value || '10'))}
                min={10}
                className='mb-2'
              />
              <Form.Label>Test probability (%)</Form.Label>
              <Form.Control
                type='number'
                value={testChance}
                onChange={(e) => setTestChance(parseInt(e.target.value || '0'))}
                min={0}
                max={100}
              />
            </Form.Group>
          )}
        </Form>
      </Body>
      <Footer>
        <Button variant='primary' onClick={handleSave} disabled={saving}>
          Save
        </Button>
        <Button variant='dark' onClick={() => showModal(null)}>
          Cancel
        </Button>
      </Footer>
    </Modal>
  );
}
