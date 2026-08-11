import { useMemo, useState } from 'react';
import type { CategoryType } from '../schemaTypes';
import type { ImageMenuItem } from '../useImageMenuItems';
import { formatShortcutKey } from '../utils/hotkeys';

export interface MenuState {
  x: number;
  y: number;
  items: ImageMenuItem[];
}

export function ImageFileStatusOverlay({
  loading,
  fileCount,
  imageId,
}: {
  loading: boolean;
  fileCount: number;
  imageId: string;
}) {
  if (loading) {
    return (
      <CenterNotice
        title='Loading image files...'
        titleColor='#333'
        body='Please wait while we fetch the available layers.'
      />
    );
  }
  if (fileCount === 0) {
    return (
      <CenterNotice
        title='⚠️ No Image Files Found'
        titleColor='red'
        body={`Image ID: ${imageId} — this image has no associated files in the database.`}
      />
    );
  }
  return null;
}

export function AnnotationLegendOverlay({
  categories,
  currentCategoryId,
  forceVisible,
  onSelectCategory,
}: {
  categories: CategoryType[];
  currentCategoryId?: string;
  forceVisible?: boolean;
  onSelectCategory: (category: CategoryType) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );
  if (sortedCategories.length === 0) return null;

  return (
    <div
      className={forceVisible ? 'd-block' : 'd-block d-md-none'}
      style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 5 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div
        style={{
          background: 'white',
          color: '#333',
          borderRadius: 6,
          boxShadow: '0 1px 5px rgba(0,0,0,0.4)',
          padding: expanded ? 4 : '6px 10px',
          fontSize: 14,
        }}
      >
        {expanded
          ? sortedCategories.map((category) => (
              <div
                key={category.id}
                onClick={() => onSelectCategory(category)}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: 8,
                  cursor: 'pointer',
                  backgroundColor:
                    currentCategoryId === category.id
                      ? '#bdbebf'
                      : 'transparent',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: category.color || '#000',
                    flexShrink: 0,
                  }}
                />
                <span style={{ flexGrow: 1 }}>{category.name}</span>
                <span>({formatShortcutKey(category.shortcutKey)})</span>
              </div>
            ))
          : 'Legend'}
      </div>
    </div>
  );
}

export function ContextMenuOverlay({
  menu,
  onClose,
}: {
  menu: MenuState | null;
  onClose: () => void;
}) {
  if (!menu) return null;

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9 }}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: menu.x,
          top: menu.y,
          zIndex: 10,
          background: 'white',
          color: '#333',
          borderRadius: 4,
          boxShadow: '0 1px 5px rgba(0,0,0,0.4)',
          minWidth: 180,
          maxWidth: 320,
          overflow: 'hidden',
          fontSize: 13,
        }}
      >
        {menu.items.map((item, index) => (
          <div
            key={index}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.callback?.();
            }}
            style={{
              padding: '6px 12px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: item.disabled ? 'default' : 'pointer',
              color: item.disabled ? '#999' : '#333',
            }}
            onMouseEnter={(event) => {
              if (!item.disabled) {
                event.currentTarget.style.background = '#f0f0f0';
              }
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = '';
            }}
          >
            {item.text}
          </div>
        ))}
      </div>
    </>
  );
}

function CenterNotice({
  title,
  titleColor,
  body,
}: {
  title: string;
  titleColor: string;
  body: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(255,255,255,0.9)',
        padding: '20px',
        borderRadius: '10px',
        textAlign: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{ color: titleColor, fontWeight: 'bold', marginBottom: '10px' }}
      >
        {title}
      </div>
      <div style={{ fontSize: '12px', color: '#666' }}>{body}</div>
    </div>
  );
}
