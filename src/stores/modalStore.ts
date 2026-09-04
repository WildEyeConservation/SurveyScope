import { Store } from '@tanstack/store';
import { useSelector } from '@tanstack/react-store';

type ModalState = {
  modal: string | null;
};

export const modalStore = new Store<ModalState>({
  modal: null,
});

export function openModal(name: string) {
  modalStore.setState((prev) => ({ ...prev, modal: name }));
}

export function closeModal() {
  modalStore.setState((prev) => ({ ...prev, modal: null }));
}

// React.Dispatch-compatible setter so existing
// showModal(null) / showModal('editSurvey') call sites keep working.
export function showModalAction(
  value: React.SetStateAction<string | null>
): void {
  modalStore.setState((prev) => ({
    ...prev,
    modal:
      typeof value === 'function'
        ? (value as (p: string | null) => string | null)(prev.modal)
        : value,
  }));
}

export function useModalToShow(): string | null {
  return useSelector(modalStore, (s) => s.modal);
}

export function useModalActions() {
  return { openModal, closeModal, showModal: showModalAction };
}
