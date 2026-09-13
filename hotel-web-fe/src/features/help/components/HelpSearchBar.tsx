import React from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import HistoryIcon from '@mui/icons-material/History';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import { useNavigate } from '../../../router';
import { useTranslation } from '../../../i18n';
import { useHelpArticles } from '../hooks/useHelpArticles';
import { useHelpSearch } from '../hooks/useHelpSearch';
import EmptyState from '../../../components/common/EmptyState';

const SUGGESTION_KEYS = ['refund', 'checkIn', 'staff'] as const;

/**
 * The Help Centre search field — the hub's primary action, so it gets a
 * calmer, taller input than the app default. Keyboard model mirrors the
 * global ⌘K palette: arrows move, Enter opens, Esc clears. Results render in
 * an absolutely positioned panel so the page never reflows while typing.
 */
const HelpSearchBar: React.FC = () => {
  const { t } = useTranslation('help');
  const navigate = useNavigate();
  const articles = useHelpArticles();
  const search = useHelpSearch(articles);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const openArticle = (slug: string, term: string) => {
    search.commitSearch(term);
    search.clear();
    navigate(`/help/${slug}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      search.setActiveIndex(Math.min(search.hits.length - 1, search.activeIndex + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      search.setActiveIndex(Math.max(0, search.activeIndex - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = search.hits[search.activeIndex] ?? search.hits[0];
      if (hit) {
        openArticle(hit.article.slug, search.query);
      } else {
        search.commitSearch(search.query);
      }
    } else if (e.key === 'Escape') {
      search.clear();
      inputRef.current?.blur();
    }
  };

  const { setActiveIndex, query } = search;
  React.useEffect(() => {
    setActiveIndex(0);
  }, [setActiveIndex, query]);

  React.useEffect(() => {
    panelRef.current
      ?.querySelector(`#help-hit-${search.activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [search.activeIndex]);

  const showPanel = search.showHits;
  const showRecents = !search.query && search.recentSearches.length > 0;

  return (
    <Box sx={{ position: 'relative' }}>
      <TextField
        fullWidth
        inputRef={inputRef}
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('hub.searchPlaceholder')}
        aria-label={t('search.label')}
        slotProps={{
          htmlInput: {
            role: 'combobox',
            'aria-expanded': showPanel,
            'aria-controls': 'help-search-results',
            'aria-activedescendant': showPanel ? `help-hit-${search.activeIndex}` : undefined,
          },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlinedIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                {search.isDebouncing && <CircularProgress size={16} sx={{ mr: 0.5 }} />}
                {search.query && (
                  <IconButton size="small" aria-label={t('search.clearLabel')} onClick={search.clear}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          },
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            bgcolor: 'background.paper',
            borderRadius: 2,
          },
          '& .MuiInputBase-input': { py: 1.6, fontSize: '1rem' },
        }}
      />

      {!search.query && (
        <Stack spacing={1.25} sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('search.suggestionsLabel')}
            </Typography>
            {SUGGESTION_KEYS.map((key) => (
              <Chip
                key={key}
                size="small"
                variant="outlined"
                label={t(`search.suggestions.${key}`)}
                onClick={() => search.setQuery(t(`search.suggestions.${key}`))}
                sx={{
                  cursor: 'pointer',
                  borderColor: 'divider',
                  transition: (theme) => theme.transitions.create(['border-color', 'background-color'], { duration: 'shortest' }),
                  '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' },
                }}
              />
            ))}
          </Stack>
          {showRecents && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {t('search.recentLabel')}
              </Typography>
              {search.recentSearches.map((term) => (
                <Chip
                  key={term}
                  size="small"
                  variant="outlined"
                  icon={<HistoryIcon sx={{ fontSize: 14 }} />}
                  label={term}
                  onClick={() => search.setQuery(term)}
                  sx={{ cursor: 'pointer', borderColor: 'divider' }}
                />
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {showPanel && (
        <Paper
          ref={panelRef}
          elevation={8}
          role="listbox"
          id="help-search-results"
          aria-label={t('aria.searchResults')}
          onMouseDown={(e) => e.preventDefault() /* keep input focus while clicking results */}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 1,
            zIndex: 20,
            maxHeight: 420,
            overflowY: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          {search.hits.length === 0 ? (
            <EmptyState
              icon={<SearchOutlinedIcon />}
              title={t('search.noResultsTitle')}
              description={t('search.noResultsBody')}
            />
          ) : (
            <>
              <Typography
                variant="overline"
                sx={{ display: 'block', px: 2, pt: 1.25, pb: 0.5, color: 'text.secondary', letterSpacing: '0.08em' }}
              >
                {t('search.resultsLabel')}
              </Typography>
              {search.hits.map((hit, index) => (
                <Box
                  key={hit.article.slug}
                  id={`help-hit-${index}`}
                  role="option"
                  aria-selected={index === search.activeIndex}
                  onMouseEnter={() => search.setActiveIndex(index)}
                  onClick={() => openArticle(hit.article.slug, search.query)}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    cursor: 'pointer',
                    bgcolor: index === search.activeIndex ? 'action.selected' : 'transparent',
                    '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {hit.article.title}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {hit.article.summary}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, pt: 0.25 }}>
                    {t(`categories.${hit.article.category}.name`)}
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default HelpSearchBar;
