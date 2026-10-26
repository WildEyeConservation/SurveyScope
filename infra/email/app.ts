// Deployed once by hand, outside Amplify, because an account can hold only one
// SES identity per domain and every branch deploy would otherwise recreate it:
//   npx cdk deploy --app "npx tsx infra/email/app.ts" --profile admin
import { App, Stack } from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';

const app = new App();
const stack = new Stack(app, 'SurveyScopeEmail', {
  env: { account: '275736403632', region: 'eu-west-1' },
  description: 'SES sending identity and DNS records for surveyscope.org',
});

const zone = route53.HostedZone.fromHostedZoneAttributes(stack, 'Zone', {
  hostedZoneId: 'Z08431662PTSRX04QYSDZ',
  zoneName: 'surveyscope.org',
});

// Creates the DKIM CNAMEs and the MAIL FROM MX and SPF records in the zone.
new ses.EmailIdentity(stack, 'Domain', {
  identity: ses.Identity.publicHostedZone(zone),
  mailFromDomain: 'mail.surveyscope.org',
});

new route53.TxtRecord(stack, 'Dmarc', {
  zone,
  recordName: '_dmarc',
  values: ['v=DMARC1; p=none;'],
});
