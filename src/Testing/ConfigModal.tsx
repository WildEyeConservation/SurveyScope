import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Body, Footer, Header, Modal, Title } from '../Modal';

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
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className='mb-2 inline-block'>
                    Test after * unannotated jobs
                  </label>
                </TooltipTrigger>
                <TooltipContent side='right' align='end'>
                  User will be tested if they haven't consecutively annotated in
                  the amount of jobs specified. <br /> Note: Navigating to and
                  annotating a previous job will not reset the counter.
                </TooltipContent>
              </Tooltip>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className='mb-2 inline-block'>Deadzone</label>
                </TooltipTrigger>
                <TooltipContent side='right' align='end'>
                  After the amount of jobs specified in deadzone, each of the
                  following jobs will have the specified probability of being a
                  test.
                </TooltipContent>
              </Tooltip>
              <Input
                type='number'
                value={deadzone}
                onChange={(e) => setDeadzone(parseInt(e.target.value || '10'))}
                min={10}
                className='mb-2'
              />
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
