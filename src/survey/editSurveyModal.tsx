import { Modal, Header, Title, Body } from '../Modal';
import { Schema } from '../amplify/client-schema';
import { Tabs, Tab } from '../Tabs';
import ProcessImages from './ProcessImages';
import DefineTransects from './DefineTransects';
import DefineStrata from './DefineStrata';
import EditInformation from './EditInformation';
import EditCameras from './EditCameras';
import EditMasks from './EditMasks';
import AdvancedOptions from './AdvancedOptions';
import DeleteImages from './DeleteImages';
import Logs from './Logs';
import ManageTiles from './ManageTiles';
import ManageUsers from './ManageUsers';

export default function EditSurveyModal({
  show,
  onClose,
  project,
  openTab,
}: {
  show: boolean;
  onClose: () => void;
  project: Schema['Project']['type'];
  openTab?: number;
}) {
  return (
    <Modal show={show} onHide={onClose} strict={true}>
      <Header>
        <Title>Edit Survey: {project.name}</Title>
      </Header>
      <Body>
        <Tabs defaultTab={openTab || 0}>
          <Tab label='Information'>
            <EditInformation key={project.id} projectId={project.id} />
          </Tab>
          <Tab label='Edit Cameras'>
            <EditCameras key={project.id} projectId={project.id} organizationId={project.organizationId} />
          </Tab>
          <Tab label='Masks'>
            <EditMasks key={project.id} projectId={project.id} />
          </Tab>
          <Tab label='Define Strata'>
            <DefineStrata key={project.id} projectId={project.id} organizationId={project.organizationId} />
          </Tab>
          <Tab label='Define Transects'>
            <DefineTransects key={project.id} projectId={project.id} organizationId={project.organizationId} />
          </Tab>
          <Tab label='Manage Tiles'>
            <ManageTiles key={project.id} project={project} />
          </Tab>
          <Tab label='Process Images'>
            <ProcessImages key={project.id} projectId={project.id} organizationId={project.organizationId} />
          </Tab>
          <Tab label='Manage Users'>
            <ManageUsers key={project.id} projectId={project.id} organizationId={project.organizationId} />
          </Tab>
          <Tab label='Delete Images'>
            <DeleteImages key={project.id} projectId={project.id} />
          </Tab>
          <Tab label='Advanced Options'>
            <AdvancedOptions key={project.id} projectId={project.id} />
          </Tab>
          <Tab label='Logs'>
            <Logs key={project.id} projectId={project.id} />
          </Tab>
        </Tabs>
      </Body>
    </Modal>
  );
}
