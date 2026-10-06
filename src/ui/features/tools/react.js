import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/icons.js';
import { t } from '../../i18n.js';
import { useUiLanguage } from '../../i18n-react.js';
import { fetchJson } from '../../api.js';
import { filterRadioField, openFilterDrawer } from '../../components/filter-drawer.js';
import {
  TOOL_CAPABILITIES,
  TOOL_CAPABILITY_IDS,
  capabilityCount,
  capabilityLabel,
  orderToolsForCatalog,
  toolCapabilities,
  toolMatchesFilters,
  toolsFromPayload
} from './index.js';

const h = React.createElement;

export function createToolsRoute() {
  return function ToolsRoute() {
    useUiLanguage();
    const [tools, setTools] = useState([]);
    const [loadState, setLoadState] = useState({ status: 'loading', error: '' });
    const [retryToken, setRetryToken] = useState(0);
    const [search, setSearch] = useState('');
    const [capability, setCapability] = useState('all');

    useEffect(() => {
      let active = true;
      setLoadState({ status: 'loading', error: '' });
      void fetchJson('/api/tools', { cache: 'no-store' }).then(result => {
        if (!active) return;
        const payload = toolsFromPayload(result);
        if (result?.ok === false || payload == null) {
          setTools([]);
          setLoadState({ status: 'error', error: String(result?.error || t('The tool catalog returned an unexpected response.')) });
          return;
        }
        setTools(orderToolsForCatalog(payload));
        setLoadState({ status: 'ready', error: '' });
      });
      return () => { active = false; };
    }, [retryToken]);

    const visible = useMemo(
      () => tools.filter(tool => toolMatchesFilters(tool, { search, capability })),
      [tools, search, capability]
    );
    const filtered = capability !== 'all' || Boolean(search.trim());
    const summary = loadState.status === 'error'
      ? t('Tool catalog unavailable')
      : loadState.status === 'loading'
        ? t('Loading tool catalog…')
        : t`${visible.length} of ${tools.length} tools shown`;
    const count = loadState.status === 'error'
      ? t('Unavailable')
      : loadState.status === 'loading'
        ? t('Loading…')
        : filtered ? t`Showing ${visible.length} of ${tools.length}` : t`${tools.length} Rel.AI tools`;

    const openFilters = () => openFilterDrawer({
      title: t('Tool filters'),
      value: { capability },
      resetValue: { capability: 'all' },
      renderFields(fields, draft) {
        const options = TOOL_CAPABILITIES.map(item => ({
          value: item.id,
          label: `${t(item.label)} (${capabilityCount(tools, item.id)})`
        }));
        fields.appendChild(filterRadioField({
          key: 'capability',
          label: t('Capability'),
          value: draft.capability,
          options,
          onChange: value => { draft.capability = value; }
        }));
      },
      onApply(draft) {
        setCapability(TOOL_CAPABILITY_IDS.has(draft.capability) ? draft.capability : 'all');
      }
    });

    return h('div', { className: 'settings-content system-content', 'data-tools-react': 'true' },
      h('div', { className: 'section tools-section' },
        h('div', { className: 'section-head' },
          h('div', null,
            h('h2', null, t('ChatGPT tools')),
            h('p', null, t('See the actions ChatGPT can ask Rel.AI to use for reading files, making changes, running checks, using Git, and fixing problems.'))
          ),
          h('span', { className: 'section-action', id: 'toolsCount' }, count)
        ),
        h(ToolsFilterBar, {
          search,
          capability,
          summary,
          onSearch: setSearch,
          onCapabilityClear: () => setCapability('all'),
          onClearAll: () => { setSearch(''); setCapability('all'); },
          onOpenFilters: openFilters
        }),
        h('div', { id: 'toolsBody', className: 'tools-grid' },
          loadState.status === 'loading'
            ? h('div', { className: 'skeleton-grid', role: 'status', 'aria-label': t('Loading tools') }, [0, 1, 2].map(i => h('div', { key: i, className: 'skeleton-block', 'aria-hidden': 'true' })))
            : loadState.status === 'error'
              ? h(EmptyState, {
                  iconName: 'warning',
                  title: t('Tool catalog unavailable'),
                  description: loadState.error,
                  action: t('Retry'),
                  onAction: () => setRetryToken(value => value + 1)
                })
              : visible.length
                ? visible.map(tool => h(ToolCard, { key: tool.name || tool.title || tool.displayName, tool }))
                : h(EmptyState, {
                    title: t(tools.length ? 'No matching tools' : 'No tools available'),
                    description: t(tools.length ? 'Change the search or capability filter.' : 'Rel.AI did not report any ChatGPT tools.')
                  })
        )
      )
    );
  };
}

function ToolsFilterBar({ search, capability, summary, onSearch, onCapabilityClear, onClearAll, onOpenFilters }) {
  const filters = capability === 'all' ? [] : [{ label: t('Capability'), value: t(capabilityLabel(capability)), onRemove: onCapabilityClear }];
  return h('div', { id: 'toolsToolbar' },
    h('section', { className: 'filter-bar', 'aria-label': t('List filters') },
      h('div', { className: 'filter-bar-controls' },
        h('label', { className: 'filter-search-control' },
          h('span', { className: 'sr-only' }, t('Search tools')),
          h('input', {
            type: 'search', className: 'filter-search-input', placeholder: t('Search tools'), autoComplete: 'off', value: search,
            onChange: event => onSearch(event.target.value)
          })
        ),
        h('button', {
          type: 'button',
          className: `secondary filter-open-button${filters.length ? ' active' : ''}`,
          'aria-label': filters.length ? t`Open filters; ${filters.length} active` : t('Open filters'),
          onClick: onOpenFilters
        }, filters.length ? t`Filters (${filters.length})` : t('Filters'))
      ),
      filters.length ? h('div', { className: 'filter-chip-list', 'aria-label': t('Active filters') },
        filters.map(filter => h('button', {
          key: filter.label,
          type: 'button', className: 'secondary filter-chip',
          'aria-label': t`Remove ${filter.label} filter: ${filter.value}`,
          onClick: filter.onRemove
        }, h('span', null, `${filter.label}: ${filter.value} `), h(Icon, { name: 'close', size: 14 })))
      ) : null,
      h('div', { className: 'filter-bar-footer' },
        h('span', { className: 'filter-summary', role: 'status', 'aria-live': 'polite' }, summary),
        h('button', {
          type: 'button', className: 'secondary filter-clear-button', hidden: !(search || filters.length), onClick: onClearAll
        }, t('Clear all'))
      )
    )
  );
}

function ToolCard({ tool }) {
  const capabilities = toolCapabilities(tool);
  const parameters = Array.isArray(tool.parameters) ? tool.parameters : [];
  return h('article', { className: `tool-card ${capabilities.map(item => `capability-${item}`).join(' ')}` },
    h('div', { className: 'tool-card-head' },
      h('span', { className: 'tool-capability' }, capabilities.map(value => t(capabilityLabel(value))).join(' · ')),
      h('span', { className: 'tool-parameter-count' }, parameters.length === 1 ? t`${parameters.length} parameter` : t`${parameters.length} parameters`)
    ),
    h('div', { className: 'tool-card-title' },
      h('h3', null, tool.title || tool.displayName || tool.name || t('Tool')),
      h('code', null, tool.name || '')
    ),
    h('p', null, tool.description || t('No description provided.')),
    parameters.length
      ? h('details', { className: 'tool-parameters' },
          h('summary', null, t('View parameters')),
          h('div', { className: 'tool-parameter-list' }, parameters.map(parameter => h('code', { key: parameter }, parameter)))
        )
      : h('div', { className: 'tool-parameters-empty' }, t('No input parameters'))
  );
}

function EmptyState({ iconName = 'info', title, description, action = '', onAction }) {
  return h('div', { className: 'empty-state' },
    h('span', { className: 'empty-state-icon', 'aria-hidden': 'true' }, h(Icon, { name: iconName, size: 28 })),
    h('strong', { className: 'empty-state-title' }, title),
    h('p', { className: 'empty-state-copy' }, description),
    action ? h('button', { type: 'button', className: 'secondary', onClick: onAction }, action) : null
  );
}
