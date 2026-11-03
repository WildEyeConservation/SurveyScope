import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Body, Footer, Header, Modal, Title } from '../Modal';

type TestType = 'random' | 'interval';

// Jobs before random testing starts.
const RANDOM_DEADZONE = 10;

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
  const [confirmation, setConfirmation] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const { client, showModal } = useContext(GlobalContext)!;

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
      }

      setConfirmation(config.postTestConfirmation!);
    };
    if (show) {
      fetchTestConfig();
    } else {
      setTestInterval(0);
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
    }

    setSaving(true);

    await client.models.ProjectTestConfig.update({
      projectId: survey.id,
      testType: testType,
      random: testType === 'random' ? testChance : undefined,
      deadzone: testType === 'random' ? RANDOM_DEADZONE : undefined,
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
        <form className='p-4'>
          <div className='mb-2'>
            <Label>Test type</Label>
            <NativeSelect
              value={testType}
              onChange={(e) =>
                setTestType(e.target.value as 'random' | 'interval')
              }
            >
              <option value='random'>Random</option>
              <option value='interval'>Interval</option>
            </NativeSelect>
          </div>
          {testType === 'interval' && (
            <div className='mb-2'>
              <Label>
                Test after this many jobs in a row with no annotations
              </Label>
              <Input
                type='number'
                value={testInterval}
                onChange={(e) =>
                  setTestInterval(parseInt(e.target.value || '10'))
                }
                min={10}
              />
            </div>
          )}
          {testType === 'random' && (
            <div className='mb-2'>
              <Label>Test probability (%)</Label>
              <Input
                type='number'
                value={testChance}
                onChange={(e) => setTestChance(parseInt(e.target.value || '0'))}
                min={0}
                max={100}
              />
            </div>
          )}
        </form>
      </Body>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={() => showModal(null)}
        >
          Cancel
        </Button>
        <Button variant='primary' onClick={handleSave} disabled={saving}>
          Save
        </Button>
      </Footer>
    </Modal>
  );
}
