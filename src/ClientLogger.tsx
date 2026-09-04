import { useEffect } from 'react';
import { client } from './stores/appClient';

const ClientLogger = ({ userId }: { userId: string }) => {
  useEffect(() => {
    const logClientData = async () => {
      try {
        //Get public IP
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const { ip } = (await ipResponse.json()) as { ip: string };

        // Get browser/device info
        const ua = navigator.userAgent;
        const deviceType = /mobile/i.test(ua)
          ? 'Mobile'
          : /tablet/i.test(ua)
          ? 'Tablet'
          : 'Desktop';

        // Get connection info
        const connection =
          (navigator as any).connection ||
          (navigator as any).mozConnection ||
          (navigator as any).webkitConnection;

        const connectionType = connection?.effectiveType || 'unknown';
        const downlink = connection?.downlink || null;
        const rtt = connection?.rtt || null;

        // Create log entry
        await client.models.ClientLog.create({
          userId: userId || '',
          ipAddress: ip,
          userAgent: ua,
          deviceType,
          os: getOSFromUA(ua),
          connectionType,
          downlink,
          rtt,
        });
      } catch (error) {
        console.error('Error logging client data:', error);
      }
    };

    logClientData();
  }, [userId]);

  // Helper to parse OS from UA
  const getOSFromUA = (ua: string) => {
    if (/windows/i.test(ua)) return 'Windows';
    if (/macintosh|mac os x/i.test(ua)) return 'MacOS';
    if (/linux/i.test(ua)) return 'Linux';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
    return 'Unknown';
  };

  return null; // This component doesn't render anything
};

export default ClientLogger;
