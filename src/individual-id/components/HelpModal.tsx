import { Modal, Button } from 'react-bootstrap';
import * as jdenticon from 'jdenticon';
import { EyeOff, Layers } from 'lucide-react';
import type { MarkerKind } from '../IndividualIdMap';

interface Props {
  show: boolean;
  onHide: () => void;
}

// Style maths mirrors applyMarkerStyle in IndividualIdMap — keep in sync.
function DemoMarker({
  kind,
  status = 'pending',
  active = false,
  obscured = false,
  color = '#4F9DDE',
  seed = 'detweb-primary',
}: {
  kind: MarkerKind;
  status?: 'pending' | 'accepted';
  active?: boolean;
  obscured?: boolean;
  color?: string;
  seed?: string;
}) {
  const size = 20;
  const shadows: string[] = [];
  if (active) shadows.push('0 0 0 3px #ff8c1a');
  if (status === 'accepted') {
    shadows.push(active ? '0 0 0 6px #27ae60' : '0 0 0 3px #27ae60');
  } else if (!active) {
    shadows.push('0 0 0 1px rgba(0, 0, 0, 0.45)');
  }
  const isShadow = kind === 'shadow';
  const identiconSvg =
    kind === 'primary' ? jdenticon.toSvg(seed, Math.round(size * 0.7)) : '';

  return (
    // Muted backdrop so proposed (white) and real (dark) borders both read correctly over aerial imagery.
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 6,
        background: '#7c8a7c',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: color,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: isShadow
              ? '2px solid #ffffff'
              : '1px solid rgba(0, 0, 0, 0.7)',
            opacity: isShadow ? 0.75 : 1,
            boxShadow: shadows.join(', '),
          }}
          {...(kind === 'primary'
            ? { dangerouslySetInnerHTML: { __html: identiconSvg } }
            : {})}
        />
        {obscured && (
          <div
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: '#ffffff',
              border: '1px solid #1f2933',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
          >
            <EyeOff size={11} color='#1f2933' strokeWidth={2.75} />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  demo,
  label,
  children,
}: {
  demo: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='d-flex flex-row align-items-center gap-3 mb-3'>
      <div>{demo}</div>
      <div>
        <strong>{label}</strong>
        <div style={{ opacity: 0.85, fontSize: 13 }}>{children}</div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className='mb-4'>
      <h6
        className='mb-3'
        style={{
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: 12,
          opacity: 0.7,
        }}
      >
        {title}
      </h6>
      {children}
    </section>
  );
}

export function HelpModal({ show, onHide }: Props) {
  return (
    <Modal show={show} onHide={onHide} size='lg' centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title>How ChainLinker works</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p style={{ opacity: 0.85 }}>
          You are linking the same animal across an overlapping pair of images
          so it is only counted once. Here is everything on screen and how to
          drive it.
        </p>

        <Section title='Marker types'>
          <Row demo={<DemoMarker kind='primary' />} label='Primary'>
            A real annotation that owns the canonical identity. Shows a unique
            pattern (jdenticon) inside a dark border.
          </Row>
          <Row demo={<DemoMarker kind='secondary' />} label='Secondary'>
            A real annotation that is already linked to a primary on the other
            image. Dark border, no pattern — just a coloured dot.
          </Row>
          <Row demo={<DemoMarker kind='shadow' />} label='Proposed'>
            A position the system predicts for the animal but with no
            annotation yet. Distinct white border and slightly faded. Confirming
            it creates the real annotation.
          </Row>
          <Row
            demo={<DemoMarker kind='primary' obscured />}
            label='Obscured'
          >
            An eye-off badge in the top-right corner. The object{' '}
            <em>is</em> physically in this image, but something in front of it
            blocks the view — for example an animal standing behind a tree. The
            marker still sits at the object's real position on the map; toggle
            the flag from the marker's popup. This is <em>not</em> the same as
            out-of-view (explained below).
          </Row>
        </Section>

        <Section title='Markers from other labels'>
          <Row
            demo={
              <DemoMarker
                kind='primary'
                color='#E0A33D'
                seed='other-label'
              />
            }
            label='Informational marker'
          >
            A marker in a <em>different colour</em> belongs to another
            label. It is shown only so you can see that animal is already
            marked — it is <strong>not part of this task</strong> and is
            ignored by linking, accepting and pair completion. You can still
            drag it, or use its popup to change its label or delete it.
            Changing its label to the label you are working on promotes it
            into the workflow as a normal marker.
          </Row>
        </Section>

        <Section title='Selection & status'>
          <Row demo={<DemoMarker kind='primary' active />} label='Selected'>
            Orange border — this is the active marker. Keyboard actions and
            manual links apply to it.
          </Row>
          <Row
            demo={<DemoMarker kind='primary' status='accepted' />}
            label='Accepted'
          >
            Green ring — the pair is linked and counted. Done.
          </Row>
        </Section>

        <Section title='Map controls'>
          <div className='d-flex flex-row align-items-center gap-3 mb-3'>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 6,
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Layers size={20} color='#333' strokeWidth={2.5} />
            </div>
            <div>
              <strong>Toggle homography overlay</strong>
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                Projects the other image of the pair onto this one as an
                outline + grid, so you can see where an animal on the other
                image should fall here. Toggle it on while hunting for a match,
                off when it gets in the way.
              </div>
            </div>
          </div>
          <p style={{ opacity: 0.85, fontSize: 13 }}>
            The zoom and rotate controls do the obvious thing and need no
            explanation.
          </p>
        </Section>

        <Section title='Out-of-view annotations'>
          <p style={{ opacity: 0.85, fontSize: 14 }}>
            Out-of-view (OOV) is the <em>opposite</em> of obscured: the object
            is <strong>not in this frame at all</strong>. The same animal was
            captured in nearby images, but plane roll (or similar camera
            geometry) means it physically falls outside this frame.
          </p>
          <p style={{ opacity: 0.85, fontSize: 14, marginBottom: 0 }}>
            To create one, hover a proposed (white-bordered) marker whose
            partner exists on the other image, then choose{' '}
            <strong>Move to OOV</strong> from its popup. The proposed marker
            is converted into an OOV linked to its partner. Because OOVs have
            no position they don't show on the map — they appear as cards in
            the <strong>side panel for that image</strong>, where you can
            still delete one if you change your mind.
          </p>
        </Section>

        <Section title='The Space-key workflow'>
          <ol style={{ opacity: 0.9, fontSize: 14, paddingLeft: 18 }}>
            <li className='mb-2'>
              Press <strong>Space</strong>. The next candidate becomes active
              (orange) and both images pan to it. Drag the real marker and
              the proposed marker to line them up precisely.
            </li>
            <li className='mb-2'>
              Press <strong>Space</strong> again to{' '}
              <strong>accept</strong> the pair (green ring) — the two markers
              are now linked, and focus advances to the next candidate.
            </li>
          </ol>
          <p style={{ opacity: 0.85, fontSize: 14 }}>
            <strong>Manual linking:</strong> select a marker (orange active
            border), then on the <em>other</em> image{' '}
            <strong>Ctrl/⌘ + left-click</strong> a real marker to link the
            two directly.
          </p>
          <p style={{ opacity: 0.85, fontSize: 14, marginBottom: 6 }}>
            <strong>Keyboard shortcuts</strong>
          </p>
          <ul style={{ opacity: 0.9, fontSize: 14, paddingLeft: 18, marginBottom: 0 }}>
            <li>
              <strong>Space</strong> — focus the next candidate, or accept the
              focused one.
            </li>
            <li>
              <strong>←/→</strong> — move focus to the previous or next
              candidate. Clicking a marker focuses it too.
            </li>
            <li>
              <strong>Esc</strong> — clear the focused candidate.
            </li>
            <li>
              <strong>Hold Tab</strong> — hide all markers to see the imagery
              underneath.
            </li>
            <li>
              <strong>Ctrl+←/→</strong> — previous or next image pair.
            </li>
          </ul>
        </Section>

        <Section title='Navigating pairs'>
          <p style={{ opacity: 0.85, fontSize: 14 }}>
            Move freely between image pairs with the{' '}
            <strong>←/→ arrow buttons</strong> in the toolbar, or by clicking a
            pair marker in the <strong>progress bar</strong> below it. Your
            changes are always preserved when you move.
          </p>
          <p style={{ opacity: 0.85, fontSize: 14, marginBottom: 0 }}>
            <strong>Simple view</strong> is on by default: it shows only the
            pairs that still need your attention, plus the three pairs on each
            side for continuity. Turn it off to see every pair in the transect.
          </p>
        </Section>

        <Section title='Finishing a pair'>
          <p style={{ opacity: 0.85, fontSize: 14, marginBottom: 0 }}>
            Once every marker pair on the current images is accepted, a dialog
            appears offering to jump to the next pair that needs attention — or
            you can choose to stay on the current pair.
          </p>
        </Section>

        <Section title='Reunion review'>
          <p style={{ opacity: 0.85, fontSize: 14 }}>
            When every direct image pair is finished, the system scans for{' '}
            <strong>reunions</strong>: image pairs further along the transect
            where an animal you were tracking may have reappeared after going
            out of view. If any are found a dialog appears (you can't skip it)
            and you're taken through them just like normal pairs — with an
            orange banner at the top so you know which phase you're in.
          </p>
          <p style={{ opacity: 0.85, fontSize: 14, marginBottom: 0 }}>
            Finishing a reunion round may merge chains and expose new
            reunions, so the system re-checks each time. Only when nothing
            new is found does the transect actually complete.
          </p>
        </Section>

        <Section title='Working alongside others'>
          <p style={{ opacity: 0.85, fontSize: 14, marginBottom: 0 }}>
            Concurrency is handled by isolating transects. The transect you are
            looking at now is <strong>yours</strong> — no one else can touch it
            while you work. It is only released back to the worker pool for
            someone else to continue if you are inactive for{' '}
            <strong>30 minutes</strong>.
          </p>
        </Section>
      </Modal.Body>
      <Modal.Footer>
        <Button variant='primary' onClick={onHide}>
          Got it
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
