import React from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface LabeledToggleSwitchProps {
  leftLabel: string;
  rightLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
}

const LabeledToggleSwitch: React.FC<LabeledToggleSwitchProps> = ({
  leftLabel,
  rightLabel,
  checked,
  onChange,
  className,
  disabled,
}) => {
  return (
    <div
      className={`flex flex-wrap -mx-3 ${className || 'mb-4 items-center'}`}
    >
      <div className='w-1/3 px-3 text-right'>
        <Label className='mb-0'>{leftLabel}</Label>
      </div>
      <div className='w-1/3 px-3 flex justify-center'>
        <Switch
          id='custom-switch'
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      </div>
      <div className='w-1/3 px-3'>
        <Label className='mb-0'>{rightLabel}</Label>
      </div>
    </div>
  );
};

export default LabeledToggleSwitch;
