import { useRouteError, useNavigate } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { useEffect, useState } from 'react';
import { reportClientError } from './reportClientError';

interface ErrorWithDetails {
  name?: string;
  message?: string;
  statusText?: string;
  status?: number;
  stack?: string;
}

export default function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const [copySuccess, setCopySuccess] = useState(false);
  console.error(error);

  useEffect(() => {
    void reportClientError(error);
  }, [error]);

  const errorObj = error as ErrorWithDetails;
  const isWebGLError =
    errorObj?.name === 'GPUInitializationError' ||
    /WebGL/i.test(errorObj?.message ?? '');

  const handleGoHome = () => {
    navigate('/');
  };

  const handleCopyStackTrace = async () => {
    try {
      const errorDetails = {
        message: errorObj?.message || errorObj?.statusText || 'Unknown error',
        status: errorObj?.status || 'N/A',
        stack: errorObj?.stack || 'No stack trace available',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      };

      const stackTraceText = `
Error Details:
-------------
Message: ${errorDetails.message}
Status: ${errorDetails.status}
Timestamp: ${errorDetails.timestamp}
URL: ${errorDetails.url}
User Agent: ${errorDetails.userAgent}

Stack Trace:
-------------
${errorDetails.stack}
      `.trim();

      await navigator.clipboard.writeText(stackTraceText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 5000); // Reset success message after 2 seconds
    } catch (err) {
      console.error('Failed to copy stack trace:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = `Error: ${
        errorObj.message || errorObj.statusText
      }\nStack: ${errorObj.stack || 'No stack trace'}`;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  return (
    <div
      id='error-page'
      className='d-flex flex-column align-items-center justify-content-center min-vh-100 text-center'
    >
      <h1>Oops!</h1>
      {isWebGLError ? (
        <div style={{ maxWidth: 560 }}>
          <p>
            Your browser can&apos;t show the images and maps SurveyScope needs.
          </p>
          <p className='mb-1 text-start'>Try these solutions:</p>
          <ul className='text-start small'>
            <li>
              Turn on hardware acceleration. In Edge, go to Settings &gt; System
              and performance and switch on &quot;Use graphics acceleration when
              available&quot;. In Chrome, go to Settings &gt; System.
            </li>
            <li>Close and reopen your browser, then try again.</li>
            <li>Try a different browser, such as Chrome, Edge or Firefox.</li>
            <li>Update your browser and graphics drivers.</li>
            <li>
              If you are using a remote desktop or virtual machine, use a
              browser on your own computer instead.
            </li>
          </ul>
        </div>
      ) : (
        <p>Sorry, an unexpected error has occurred.</p>
      )}
      <div className='d-flex gap-2'>
        <Button variant='primary' onClick={handleGoHome}>
          Back to Surveys
        </Button>
        <Button variant='outline-info' onClick={handleCopyStackTrace}>
          {copySuccess ? 'Copied!' : 'Copy Error Details'}
        </Button>
      </div>
      {copySuccess && (
        <p className='text-success mt-2 small'>
          Error details copied to clipboard! Please send this information to our
          support team.
        </p>
      )}
    </div>
  );
}
