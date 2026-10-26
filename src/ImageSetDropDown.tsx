// import { useContext } from "react"
// import { UserContext } from "./UserContext"
// import { useImageSets } from "./useGqlCached"

// export function ImageSetDropdown({setImageSet,selectedSet}){
//     const {currentProject}=useContext(UserContext)
//     const {imageSets}=useImageSets(currentProject)

//     const onSelect = (e)=>{
//         setImageSet(e.target.value)
//     }

//     return  <Form.Select value={selectedSet || "none"} onChange={onSelect}>
//                 {!selectedSet && <option value="none">Select an image set</option>}
//                 {imageSets?.map(q=><option key={q.name} value={q.name}>{q.name}</option>)}
//             </Form.Select>
// }

import { useContext } from 'react';
import { ManagementContext } from './Context';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

interface ImageSetDropdownProps {
  selectedSets: string[] | undefined;
  setImageSets: (selected: string[]) => void;
}

export function ImageSetDropdown({
  selectedSets,
  setImageSets,
}: ImageSetDropdownProps) {
  const {
    imageSetsHook: { data: imageSets },
  } = useContext(ManagementContext)!;
  const options: ComboboxOption[] =
    imageSets
      ?.map((x) => ({
        label: x.name,
        value: x.id,
      }))
      .sort((a, b) => (a.label > b.label ? 1 : -1)) ?? [];
  const selectedOptions = options.filter((o) =>
    selectedSets?.includes(o.value)
  );

  function handleChange(selectedOptions: ComboboxOption[]) {
    setImageSets(selectedOptions.map((o) => o.value));
  }

  return (
    <div>
      <Combobox
        value={selectedOptions}
        onChange={handleChange}
        multiple
        name='Image sets'
        options={options}
        placeholder='Select image sets'
      />
    </div>
  );
  // <Form.Select value={selectedSet || "none"} onChange={onSelect}>
  //             {!selectedSet && <option value="none">Select an annotation set</option>}
  //             {categories?.map(q=><option key={q.id} value={q.id}>{q.name}</option>)}
  //         </Form.Select>
}
