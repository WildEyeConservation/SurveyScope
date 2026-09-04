import type { CRUDhook } from './Context';
import Select, { SingleValue } from 'react-select';
import { useAnnotationSets } from './data/projectSets';
import { useCurrentProject, useProjectId } from './data/projectScope';

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
  const project = useCurrentProject();
  const projectId = useProjectId();
  const annotationSetsHook = useAnnotationSets(projectId) as unknown as CRUDhook<'AnnotationSet'>;
  const {
    data: annotationSets,
    create: createAnnotationSet,
  } = annotationSetsHook;
  const onNewAnnotationSet = async () => {
    const name = prompt('Please enter new AnnotationSet name', '');
    if (name) {
      setAnnotationSet(createAnnotationSet({ name, projectId: project.id, group: project.organizationId }));
    }
  };
  const options = annotationSets?.map((q) => ({ label: q.name, value: q.id }));
  if (canCreate) {
    options.push({ label: 'Add a new annotation set', value: 'new' });
  }

  const onSelect = (e: SingleValue<{ label: string; value: string }>) => {
    if (!e) return;
    if (e.value == 'new') {
      onNewAnnotationSet();
    } else {
      setAnnotationSet(e.value);
    }
  };

  return (
    <Select
      className='annotation-set-dropdown text-black'
      value={options.find((o) => o.value == selectedSet)}
      onChange={onSelect}
      name='Select annotation set'
      options={options}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
    />
  );
}
