import { useContext, useEffect, useState } from 'react';
import { UserContext } from './Context';
import { client } from './stores/appClient';
import { Schema } from './amplify/client-schema';
import Dropdown from 'react-bootstrap/Dropdown';
import DropdownButton from 'react-bootstrap/DropdownButton';
import ButtonGroup from 'react-bootstrap/ButtonGroup';

function OrganizationSelector({
  organization,
  setOrganization,
}: {
  organization: {
    id: string;
    name: string;
  };
  setOrganization: (organization: { id: string; name: string }) => void;
}) {
  const {
    myOrganizationHook: { data: myOrganizations },
  } = useContext(UserContext)!;
  const [organizations, setOrganizations] = useState<
    Schema['Organization']['type'][]
  >([]);

  useEffect(() => {
    // Only fetch organizations if we have admin memberships and haven't already loaded them
    if (!myOrganizations?.length) return;

    const adminMemberships = myOrganizations.filter(
      (membership) => membership.isAdmin
    );
    if (!adminMemberships.length) return;

    // Check if we already have the organizations and they match the current admin memberships
    const currentOrgIds = organizations.map((org) => org.id).sort();
    const newOrgIds = adminMemberships.map((m) => m.organizationId).sort();

    if (
      currentOrgIds.length === newOrgIds.length &&
      currentOrgIds.every((id, index) => id === newOrgIds[index])
    ) {
      return; // No changes needed
    }

    Promise.all(
      adminMemberships.map(
        async (membership) =>
          (
            await client.models.Organization.get({
              id: membership.organizationId,
            })
          ).data
      )
    ).then((allOrganizations) => {
      const validOrganizations = allOrganizations.filter(
        (organization) => organization !== null
      );
      setOrganizations(validOrganizations);

      // Auto-select organization only if there's exactly one and no organization is currently selected
      if (
        validOrganizations.length === 1 &&
        validOrganizations[0]?.id &&
        !organization.id
      ) {
        setOrganization({
          id: validOrganizations[0].id,
          name: validOrganizations[0].name,
        });
      }
    });
  }, [
    myOrganizations,
    organizations,
    organization.id,
  ]);

  if (organizations.length <= 1) {
    return null;
  }

  return (
    <DropdownButton
      as={ButtonGroup}
      key={'Primary'}
      id={`dropdown-variants-Primary`}
      variant={'primary'}
      title={
        organization.id
          ? organizations.find((org) => org.id === organization.id)?.name
          : 'Select an Organisation'
      }
    >
      {organizations?.map((organization) => (
        <Dropdown.Item
          key={organization.id}
          eventKey={organization.id}
          onClick={() => {
            setOrganization({
              id: organization.id,
              name: organization.name,
            });
          }}
        >
          {organization.name}
        </Dropdown.Item>
      ))}
    </DropdownButton>
  );
}

export default OrganizationSelector;
