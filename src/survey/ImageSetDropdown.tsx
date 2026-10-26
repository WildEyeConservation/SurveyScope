import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { useEffect } from 'react';

export default function ImageSetDropdown({
  imageSets,
  selectedImageSets,
  setSelectedImageSets,
  hideIfOneImageSet = false,
}: {
  imageSets: { id: string; name: string }[];
  selectedImageSets: string[];
  setSelectedImageSets: (imageSets: string[]) => void;
  hideIfOneImageSet?: boolean;
}) {
  useEffect(() => {
    if (imageSets.length === 1 && selectedImageSets) {
      const singleId = imageSets[0].id;
      if (!selectedImageSets.includes(singleId)) {
        setSelectedImageSets([singleId]);
      }
    }
  }, [imageSets, selectedImageSets, setSelectedImageSets]);

  if (hideIfOneImageSet && imageSets.length === 1) {
    return null;
  }

  const options = imageSets.map((imageSet) => ({
    label: imageSet.name,
    value: imageSet.id,
  }));

  return (
    <div>
      <Label className='mb-0'>Image Sets</Label>
      <span className='text-muted-foreground block mb-1' style={{ fontSize: '12px' }}>
        Select the image sets you want to use.
      </span>
      <Combobox
        options={options}
        onChange={(selectedOptions) =>
          setSelectedImageSets(selectedOptions.map((option) => option.value))
        }
        value={options.filter((option) =>
          selectedImageSets.includes(option.value)
        )}
        multiple
        placeholder='Select image sets'
        name='Image sets'
      />
    </div>
  );
}
