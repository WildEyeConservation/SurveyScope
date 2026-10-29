import { defineAuth } from "@aws-amplify/backend";
import { handleNewUser } from "../functions/handleNewUser/resource";
import { customMessage } from "../functions/customMessage/resource";
import { addUserToGroup } from "../functions/add-user-to-group/resource";
import { createGroup } from "../data/create-group/resource";
import { listUsers } from "../data/list-users/resource";
import { listGroupsForUser } from "../data/list-groups-for-user/resource";
import { removeUserFromGroup } from "../data/remove-user-from-group/resource";
import { createOrganization } from "../functions/createOrganization/resource";
import { inviteUserToOrganization } from "../functions/inviteUserToOrganization/resource";
import { respondToInvite } from "../functions/respondToInvite/resource";
import { removeUserFromOrganization } from "../functions/removeUserFromOrganization/resource";
import { syncOrganizationGroups } from "../functions/syncOrganizationGroups/resource";
import { reportClientError } from "../functions/reportClientError/resource";
/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: "CODE",
      verificationEmailSubject: "Verify your SurveyScope account",
      verificationEmailBody: (createCode) =>
        `Welcome to SurveyScope! Your verification code is: ${createCode()}`,
      userInvitation: {
        emailSubject: "You are invited to join SurveyScope",
        emailBody: (user, code) =>
          `Welcome to SurveyScope! You can now login with username ${user()} and temporary password ${code()}`,
      },
    },
  },
  userAttributes: {
    preferredUsername: {
      mutable: true,
      required: true,
    },
  },
  senders: {
    email: {
      fromEmail: "no-reply@surveyscope.org",
      fromName: "SurveyScope",
      // Set AUTH_REPLY_TO_EMAIL in the Amplify branch environment.
      replyTo: process.env.AUTH_REPLY_TO_EMAIL || undefined,
    },
  },
  groups: ["sysadmin", "orgadmin"],
  triggers: { postConfirmation: handleNewUser, customMessage },
  access: (allow) => [
    allow.resource(handleNewUser).to(["addUserToGroup", "listUsers"]),
    allow.resource(createGroup).to(["createGroup"]),
    allow.resource(listUsers).to(["listUsers", "listUsersInGroup"]),
    allow.resource(listGroupsForUser).to(["listGroupsForUser"]),
    allow.resource(removeUserFromGroup).to(["removeUserFromGroup"]),
    allow.resource(addUserToGroup).to(["addUserToGroup"]),
    allow.resource(createOrganization).to(["listUsers", "createGroup", "addUserToGroup"]),
    allow.resource(inviteUserToOrganization).to(["listUsers"]),
    allow.resource(respondToInvite).to(["addUserToGroup"]),
    allow.resource(removeUserFromOrganization).to(["removeUserFromGroup"]),
    allow.resource(syncOrganizationGroups).to(["addUserToGroup", "listGroupsForUser"]),
    allow.resource(reportClientError).to(["getUser"]),
  ],
});
