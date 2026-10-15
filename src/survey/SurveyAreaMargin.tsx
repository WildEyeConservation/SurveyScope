export default function SurveyAreaMargin({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className='d-flex flex-column gap-1 mt-2'>
      <div className='d-flex align-items-center gap-2'>
        <label className='mb-0' htmlFor='survey-area-margin'>
          Count images within
        </label>
        <input
          type='number'
          id='survey-area-margin'
          className='form-control'
          style={{ width: '90px' }}
          min={0}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>m of the boundary as inside it</span>
      </div>
      <span className='text-muted' style={{ fontSize: 12 }}>
        Images outside the boundary or inside an exclusion zone are left out of
        transects and results.
      </span>
    </div>
  );
}
