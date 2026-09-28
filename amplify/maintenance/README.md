# Maintenance rollout

Deploy the backend and frontend together, with the backend available first. A frontend built with these controls requires the new status operations; it intentionally blocks ordinary users if availability cannot be checked. Ensure users load this frontend before the first maintenance window so existing tabs can display the banner and maintenance screen. No data migration or initial singleton seeding is required.

## Enforcement limits

Existing subscriptions are disconnected when the client workspace unmounts. The guard does not revoke already-established subscriptions on an old client, interrupt already-running server requests/jobs, or revoke previously issued S3 URLs/direct AWS permissions. This is an application maintenance gate, not an infrastructure shutdown. Allow in-flight operations to drain before incompatible migrations.
