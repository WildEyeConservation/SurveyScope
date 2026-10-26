import { useContext } from 'react';
import { ProjectContext, ManagementContext } from './Context';
import { Combobox } from '@/components/ui/combobox';

interface AnnotationSetDropdownProps {
  setAnnotationSet: (arg0: string) => void;
  selectedSet: string | undefined;
  canCreate?: boolean;
}

export function AnnotationSetDropdown({
  setAnnotationSet,
  selectedSet,
  canCreate = true,
}: AnnotationSetDropdownProps) {
  // Look into this, UserContext is not passing through items within it
  const { project } = useContext(ProjectContext)!;
  const {
    annotationSetsHook: { data: annotationSets, create: createAnnotationSet },
  } = useContext(ManagementContext)!;
  const onNewAnnotationSet = async () => {
    const name = prompt('Please enter new AnnotationSet name', '');
    if (name) {
      setAnnotationSet(
        createAnnotationSet({
          name,
          projectId: project.id,
          group: project.organizationId,
        })
      );
    }
  };
  const options =
    annotationSets?.map((q) => ({ label: q.name, value: q.id })) ?? [];
  if (canCreate) {
    options.push({ label: 'Add a new annotation set', value: 'new' });
  }

  const onSelect = (option: { label: string; value: string } | null) => {
    if (!option) return;
    if (option.value == 'new') {
      onNewAnnotationSet();
    } else {
      setAnnotationSet(option.value);
    }
  };

  return (
    <Combobox
      className='annotation-set-dropdown'
      value={options.find((o) => o.value == selectedSet) ?? null}
      onChange={onSelect}
      name='Select annotation set'
      options={options}
      placeholder='Select annotation set'
    />
  );
}
