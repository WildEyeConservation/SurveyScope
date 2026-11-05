import { DataClient } from '../../amplify/shared/data-schema.generated';

/**
 * Logs an admin action to the database
 * @param client - The Amplify data client
 * @param userId - The ID of the user performing the action
 * @param message - The log message (text description of the action)
 * @param projectId - The project ID the action is related to
 * @param group - The organization ID for group-based access control
 */
export async function logAdminAction(
  client: DataClient,
  userId: string,
  message: string,
  projectId: string,
  group: string,
): Promise<void> {
  try {
    await client.models.AdminActionLog.create({
      userId,
      message,
      projectId,
      group,
    });
  } catch (error) {
    // Log error but don't throw - we don't want logging failures to break the app
    console.error('Failed to log admin action:', error);
  }
}
