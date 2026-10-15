import { Form } from 'react-bootstrap';

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
      <label className='mb-0' htmlFor='survey-area-margin'>
        Boundary margin
      </label>
      <div className='d-flex align-items-center gap-2'>
        <input
          type='number'
          id='survey-area-margin'
          className='form-control'
          style={{ width: '100px' }}
          min={0}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>m</span>
      </div>
      <Form.Text className='d-block mt-0' style={{ fontSize: 12 }}>
        Images within this distance of the boundary count as inside it. Images
        further out, or in an exclusion zone, are left out of transects and
        results.
      </Form.Text>
    </div>
  );
}
