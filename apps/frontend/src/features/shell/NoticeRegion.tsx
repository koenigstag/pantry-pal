import { X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { useNotices } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';

interface NoticeRegionProps {
  /**
   * `page` clears the phone's bottom tab bar. `dialog` is for rendering inside a
   * full-screen dialog: a modal dialog covers the page's own region and makes it
   * inert, so notices raised while one is open would otherwise go unseen.
   */
  placement?: 'page' | 'dialog';
}

export const NoticeRegion = observer(function NoticeRegion({
  placement = 'page',
}: NoticeRegionProps): ReactElement {
  const notices = useNotices();

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-20 flex flex-col items-center gap-2 px-4',
        placement === 'page'
          ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6'
          : 'bottom-[max(1rem,env(safe-area-inset-bottom))]',
      )}
    >
      {notices.notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl py-1 ps-4 pe-1 text-sm shadow-lg',
            notice.tone === 'error' ? 'bg-danger text-surface' : 'bg-ink text-canvas',
          )}
        >
          <span className="flex-1 py-1.5">{notice.message}</span>
          <IconButton
            icon={X}
            label={messages.common.close}
            size="sm"
            onClick={() => notices.dismiss(notice.id)}
            className="hover:bg-canvas/15"
          />
        </div>
      ))}
    </div>
  );
});
