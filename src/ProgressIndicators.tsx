import { CircularProgress, CircularProgressProps } from '@mui/material';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { useContext } from 'react';
import { ProgressContext } from './progress';

interface CircularProgressWithLabelProps extends CircularProgressProps {
  value?: number;
  detail: JSX.Element;
}

function CircularProgressWithLabel(props: CircularProgressWithLabelProps) {
  return (
    <OverlayTrigger
      placement='bottom'
      delay={{ show: 250, hide: 400 }}
      overlay={<Tooltip id='button-tooltip-2'>{props.detail}</Tooltip>}
    >
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <CircularProgress
          variant={props.value ? 'determinate' : 'indeterminate'}
          {...props}
        />
        {props.value !== undefined && (
          <Box
            sx={{
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography
              variant='caption'
              component='div'
              color='text.secondary'
            >
              {`${Math.round(props.value)}%`}
            </Typography>
          </Box>
        )}
      </Box>
    </OverlayTrigger>
  );
}

export function ProgressIndicators() {
  const { progress } = useContext(ProgressContext)!;
  if (!progress) return null;
  return (
    <>
      {Object.keys(progress).map((key) => (
        <CircularProgressWithLabel
          key={key}
          value={progress[key].value}
          detail={progress[key].detail}
          color='inherit'
          size={50}
          thickness={8}
        />
      ))}
    </>
  );
}
