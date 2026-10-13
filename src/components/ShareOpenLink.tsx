import type { ReactNode } from 'react';
import {
  bridgeOpenUrl,
  copySharePath,
  ONE_CLICK_SETTINGS_HREF,
  openingMessage,
  type ShareTargetKind,
} from '../lib/bridgeOpen';
import { pushToast } from '../stores/toastStore';

// ===========================================================================
// ★★★ fix-654 (P-149) — a link to a folder or file on \\bpc-file
// ===========================================================================
//
// A PLAIN `<a href="bridge-open:…">`: the browser hands the link to the Bridge
// opener when this PC has it installed (Chrome first asks once — "Always
// allow"). The click handler ALSO copies the path and says so, every time,
// because a PC without the opener does nothing on its own and a person must
// still be able to paste the path into File Explorer.
//
// ★ The handler never calls preventDefault: the navigation IS the open.

export default function ShareOpenLink({
  path,
  kind,
  className,
  testId,
  children,
}: {
  path: string;
  kind: ShareTargetKind;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={bridgeOpenUrl(path)}
      className={className}
      title={path}
      data-testid={testId}
      onClick={() => {
        void copySharePath(path).then((copied) =>
          pushToast(openingMessage(kind, copied), 'info', {
            link: { label: 'Set up one-click folders', href: ONE_CLICK_SETTINGS_HREF },
          }),
        );
      }}
    >
      {children}
    </a>
  );
}
