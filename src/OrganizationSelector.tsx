import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext, UserContext } from './Context';
import { Schema } from './amplify/client-schema';

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
  const { client } = useContext(GlobalContext)!;
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
      (membership) => membership.isAdmin,
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
          ).data,
      ),
    ).then((allOrganizations) => {
      const validOrganizations = allOrganizations.filter(
        (organization) => organization !== null,
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
    client.models.Organization,
  ]);

  if (organizations.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu key={'Primary'}>
      <DropdownMenuTrigger asChild>
        <Button id={`dropdown-variants-Primary`} variant={'primary'}>
          {organization.id
            ? organizations.find((org) => org.id === organization.id)?.name
            : 'Select an Organisation'}{' '}
          <ChevronDown className='size-3' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {organizations?.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            onSelect={() => {
              setOrganization({
                id: organization.id,
                name: organization.name,
              });
            }}
          >
            {organization.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OrganizationSelector;
