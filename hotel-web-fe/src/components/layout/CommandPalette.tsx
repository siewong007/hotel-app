import React from 'react';
import {
  Box,
  Typography,
  Popover,
  InputBase,
  CircularProgress,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { storage } from '../../utils/storage';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import { searchArticles } from '../../features/help/utils';
import { useHelpArticles } from '../../features/help/hooks/useHelpArticles';
import {
  canAccessNavigationRoute,
  navigationRouteDefinitions,
} from '../../navigation/routeRegistry';
import { useRouteLabels } from '../../navigation/routeLabels';

const PaletteContext = React.createContext<{ open: () => void } | null>(null);

export const useCommandPalette = () => {
  const ctx = React.useContext(PaletteContext);
  if (!ctx) throw new Error('useCommandPalette outside provider');
  return ctx;
};

// Owns the ⌘K command palette previously embedded in NavigationTabs: state,
// recents, federated search and the Popover itself. Mounted once in RootLayout
// (inside the staff shell) so any trigger can open it via useCommandPalette().
export const CommandPaletteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { hasPermission, hasRole, getRoutePolicy, user } = useAuth();
  const isGuest = hasRole('guest') || user?.user_type === 'guest';
  const { navLabel: navLabelFor } = useRouteLabels();
  const helpArticles = useHelpArticles();
  const visibleItems = React.useMemo(
    () =>
      navigationRouteDefinitions.filter((item) =>
        canAccessNavigationRoute(item, { hasPermission, hasRole, getRoutePolicy })
      ),
    [hasPermission, hasRole, getRoutePolicy]
  );

  const renderNavIcon = React.useCallback(
    (item: (typeof visibleItems)[number], size: number) => {
      const Icon = item.icon;
      return Icon ? <Icon sx={{ fontSize: size }} /> : null;
    },
    []
  );

  /* ---------------- Command palette ---------------- */
  const bookingsRoute = visibleItems.find((i) => i.path === '/bookings');
  const cmdInputRef = React.useRef<HTMLInputElement | null>(null);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [cmdQuery, setCmdQuery] = React.useState('');
  const [scope, setScope] = React.useState<'all' | 'bookings' | 'guests' | 'ledgers' | 'rooms' | 'pages' | 'help'>('all');
  const [activeIndex, setActiveIndex] = React.useState(0);

  // The palette opens from any trigger now, so it anchors to the viewport
  // centre (the old code anchored to the topbar search box element). Tracked in
  // state so the Popover's own resize handling keeps it centred.
  const [viewportCenterX, setViewportCenterX] = React.useState(() => window.innerWidth / 2);
  React.useEffect(() => {
    const onResize = () => setViewportCenterX(window.innerWidth / 2);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  type Recent = { title: string; subtitle?: string; route: string; kind: string };
  const [recents, setRecents] = React.useState<Recent[]>(
    () => (isGuest ? [] : storage.getItem<Recent[]>('cmdRecents') || [])
  );

  React.useEffect(() => {
    if (!isGuest) return;
    setRecents([]);
    storage.removeItem('cmdRecents');
  }, [isGuest]);

  const term = cmdQuery.trim();
  const slash = term.startsWith('/');
  const lowTerm = (slash ? term.slice(1) : term).toLowerCase();

  // Server-side federated search (skipped for /commands or the client-only scopes)
  const serverEnabled = !isGuest && cmdOpen && !slash && scope !== 'pages' && scope !== 'help';
  const serverTypes =
    scope === 'bookings' || scope === 'guests' || scope === 'ledgers' || scope === 'rooms' ? [scope] : undefined;
  const { groups: serverGroups, loading: serverLoading } = useGlobalSearch(
    serverEnabled ? cmdQuery : '',
    { types: serverTypes, enabled: serverEnabled }
  );

  type SelectItem = {
    key: string;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    route: string;
  };
  type Group = { key: string; label: string; items: SelectItem[] };

  const dot = React.useMemo(
    () => <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled' }} />,
    []
  );

  const persistRecent = (r: Recent) => {
    const next = [r, ...recents.filter((x) => !(x.route === r.route && x.title === r.title))].slice(0, 6);
    setRecents(next);
    storage.setItem('cmdRecents', next);
  };

  const bookingSearchValueFromTitle = (title: string) => {
    const trimmed = title.trim();
    if (/^BK-[A-Za-z0-9-]+$/i.test(trimmed)) return trimmed;
    const numericId = trimmed.match(/^#(\d+)$/);
    return numericId?.[1] || null;
  };

  const routeForSelection = (item: SelectItem) => {
    const [path, rawSearch = ''] = item.route.split('?');
    const title = item.title.trim();
    const ledgerIdTitle = title.match(/^Ledger #(\d+)$/i);
    const searchValue = item.route.startsWith('/bookings')
      ? bookingSearchValueFromTitle(title)
      : item.route.startsWith('/guest-config')
        ? title
        : item.route.startsWith('/company-ledger')
          ? (ledgerIdTitle?.[1] || title)
          : null;
    if (!searchValue) return item.route;

    const params = new URLSearchParams(rawSearch);
    const existingSearch = params.get('search');
    params.set('search', searchValue);
    if (path === '/bookings' && existingSearch !== searchValue) params.delete('booking_id');
    return `${path}?${params.toString()}`;
  };

  const openCmd = React.useCallback(() => {
    setCmdOpen(true);
    setActiveIndex(0);
    window.setTimeout(() => cmdInputRef.current?.focus(), 0);
  }, []);
  const closeCmd = () => {
    setCmdOpen(false);
    setCmdQuery('');
    setScope('all');
  };

  const groups: Group[] = React.useMemo(() => {
    const showClient = scope === 'all' || scope === 'pages';
    const out: Group[] = [];

    if (!isGuest && !term && recents.length > 0 && scope === 'all') {
      out.push({
        key: 'recents',
        label: 'Recent',
        items: recents.map((r, i) => ({
          key: `recent-${i}`,
          title: r.title,
          subtitle: r.subtitle,
          icon: <HistoryIcon sx={{ fontSize: 16 }} />,
          route: r.route,
        })),
      });
    }

    if (showClient && bookingsRoute) {
      const m =
        !lowTerm ||
        'new booking'.includes(lowTerm) ||
        'booking'.includes(lowTerm) ||
        'create'.includes(lowTerm);
      if (m) {
        out.push({
          key: 'actions',
          label: 'Actions',
          items: [
            {
              key: 'act-new-booking',
              title: 'New booking',
              subtitle: 'Create a reservation',
              icon: <AddIcon sx={{ fontSize: 16 }} />,
              route: '/bookings?create=1',
            },
          ],
        });
      }
    }

    serverGroups.forEach((g) => {
      out.push({
        key: g.type,
        label: g.label,
        items: g.results.map((h) => ({
          key: `${g.type}-${h.id}`,
          title: h.title,
          subtitle: h.subtitle,
          icon: dot,
          route: h.route,
        })),
      });
    });

    if (showClient) {
      const pages = visibleItems
        .filter((item) => {
          const label = navLabelFor(item);
          return (
            !lowTerm ||
            label.toLowerCase().includes(lowTerm) ||
            item.path.toLowerCase().includes(lowTerm)
          );
        })
        .slice(0, term ? 6 : 12)
        .map((item) => ({
          key: `pg-${item.id}`,
          title: navLabelFor(item),
          subtitle: item.path,
          icon: renderNavIcon(item, 16) || dot,
          route: item.path,
        }));
      if (pages.length) out.push({ key: 'pages', label: 'Pages', items: pages });
    }

    // Help articles are client-side: the same weighted search that powers the
    // Help Centre, so ⌘K can surface guides without a backend endpoint.
    const showHelp = !isGuest && (scope === 'all' || scope === 'pages' || scope === 'help');
    if (showHelp && lowTerm.length >= 2) {
      const helpItems = searchArticles(helpArticles, lowTerm, 5).map((hit) => ({
        key: `help-${hit.article.slug}`,
        title: hit.article.title,
        subtitle: hit.article.summary,
        icon: <HelpOutlineIcon sx={{ fontSize: 16 }} />,
        route: `/help/${hit.article.slug}`,
      }));
      if (helpItems.length) out.push({ key: 'help', label: 'Help', items: helpItems });
    }

    return out;
  }, [term, lowTerm, scope, recents, serverGroups, visibleItems, bookingsRoute, dot, renderNavIcon, isGuest, navLabelFor, helpArticles]);

  const flatItems = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [cmdQuery, scope, serverGroups]);

  const select = (item: SelectItem) => {
    const route = routeForSelection(item);
    if (!isGuest) {
      persistRecent({ title: item.title, subtitle: item.subtitle, route, kind: 'nav' });
    }
    closeCmd();
    navigate(route);
  };

  const onPaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeCmd();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flatItems.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const item = flatItems[activeIndex] || flatItems[0];
      if (item) select(item);
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCmd]);

  const paletteApi = React.useMemo(() => ({ open: openCmd }), [openCmd]);

  return (
    <PaletteContext.Provider value={paletteApi}>
      {children}
      <Popover
        open={cmdOpen}
        anchorReference="anchorPosition"
        anchorPosition={{ top: 72, left: viewportCenterX }}
        onClose={closeCmd}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        marginThreshold={16}
        slotProps={{ paper: { sx: { mt: 1, width: 'min(620px, 92vw)', borderRadius: 2, overflow: 'hidden' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <InputBase
            inputRef={cmdInputRef}
            value={cmdQuery}
            onChange={(e) => setCmdQuery(e.target.value)}
            onKeyDown={onPaletteKeyDown}
            placeholder={isGuest ? 'Search pages…' : 'Search bookings, guests, rooms, pages…'}
            sx={{ flex: 1, fontSize: '0.9rem' }}
          />
          {serverLoading && <CircularProgress size={14} />}
          <Box sx={{ fontFamily: 'monospace', fontSize: '0.66rem', px: 0.875, py: '2px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 600 }}>
            esc
          </Box>
        </Box>

        {!isGuest && (
          <Box sx={{ display: 'flex', gap: 0.75, px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
            {([
              ['all', 'All'],
              ['bookings', 'Bookings'],
              ['guests', 'Guests'],
              ['ledgers', 'Ledger'],
              ['rooms', 'Rooms'],
              ['pages', 'Pages'],
              ['help', 'Help'],
            ] as const).map(([k, lb]) => {
              const on = scope === k;
              return (
                <Box
                  key={k}
                  component="button"
                  onClick={() => setScope(k)}
                  sx={{
                    px: 1.25, py: 0.5, borderRadius: 999, border: '1px solid',
                    borderColor: on ? 'text.primary' : 'divider', cursor: 'pointer',
                    fontSize: '0.72rem', fontWeight: 600,
                    color: on ? 'background.paper' : 'text.secondary',
                    bgcolor: on ? 'text.primary' : 'transparent',
                  }}
                >
                  {lb}
                </Box>
              );
            })}
          </Box>
        )}

        <Box role="listbox" sx={{ maxHeight: 380, overflowY: 'auto', py: 0.5 }}>
          {flatItems.length === 0 && (
            <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'text.secondary', fontSize: '0.85rem' }}>
              {term.length >= 2 ? 'No matches' : serverLoading ? 'Searching…' : 'Type at least 2 characters, or browse below'}
            </Box>
          )}
          {(() => {
            let idx = -1;
            return groups.map((g) => (
              <Box key={g.key}>
                <Typography sx={{ px: 1.75, pt: 1, pb: 0.5, fontSize: '0.66rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {g.label}
                </Typography>
                {g.items.map((item) => {
                  idx += 1;
                  const myIdx = idx;
                  const active = myIdx === activeIndex;
                  return (
                    <Box
                      key={item.key}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(myIdx)}
                      onClick={() => select(item)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1, cursor: 'pointer',
                        bgcolor: active ? 'action.selected' : 'transparent',
                      }}
                    >
                      <Box sx={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary', flexShrink: 0 }}>
                        {item.icon}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.title}
                        </Typography>
                        {item.subtitle && (
                          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.subtitle}
                          </Typography>
                        )}
                      </Box>
                      {active && (
                        <Box sx={{ fontFamily: 'monospace', fontSize: '0.62rem', color: 'text.secondary' }}>↵</Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            ));
          })()}
        </Box>
      </Popover>
    </PaletteContext.Provider>
  );
};
