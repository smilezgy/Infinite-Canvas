/**
 * 任务中心 —— 跨页面统一产出 / 收藏评分 / 用量统计
 * 依赖后端：/api/stats/overview、/api/tasks、/api/tasks/favorite、
 *          /api/tasks/rating、/api/tasks/delete、/api/queue/detail
 */
(function () {
    'use strict';

    var PAGE_SIZE = 48;

    var state = {
        tab: 'overview',
        q: '',
        type: '',
        providerId: '',
        days: 0,
        sort: 'new',
        favoriteOnly: false,
        offset: 0,
        total: 0,
        items: [],
        selected: {},
        filtersReady: false
    };

    var TYPE_LABELS = {
        zimage: 'Flux Gallery',
        online: '在线生图',
        klein: 'Flux Klein',
        angle: '视角重塑',
        enhance: 'Z-Image',
        canvas: '无限画布',
        video: '视频',
        comfyui: 'ComfyUI',
        jimeng: '即梦',
        midjourney: 'Midjourney',
        modelscope: 'ModelScope'
    };

    var ICONS = {
        star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><polygon points="12 2.6 15.1 9 22.2 9.9 17 14.9 18.3 22 12 18.6 5.7 22 7 14.9 1.8 9.9 8.9 9"/></svg>',
        heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
        open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
    };

    // ---------- utils ----------

    function $(id) { return document.getElementById(id); }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function num(value) {
        var n = Number(value || 0);
        if (!isFinite(n)) return '0';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
        return String(Math.round(n));
    }

    function typeLabel(type) {
        return TYPE_LABELS[type] || type || '未知';
    }

    function relativeTime(ts) {
        if (!ts) return '';
        var diff = Date.now() / 1000 - ts;
        if (diff < 60) return '刚刚';
        if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
        if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
        var d = new Date(ts * 1000);
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function fullTime(ts) {
        if (!ts) return '';
        var d = new Date(ts * 1000);
        function pad(n) { return n < 10 ? '0' + n : '' + n; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    var toastTimer = null;
    function toast(message) {
        var el = $('toast');
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
    }

    function copyText(text, label) {
        if (!text) { toast('没有可复制的内容'); return; }
        function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); toast(label + '已复制'); }
            catch (e) { toast('复制失败'); }
            document.body.removeChild(ta);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function () { toast(label + '已复制'); })
                .catch(fallback);
        } else {
            fallback();
        }
    }

    function api(path, options) {
        return fetch(path, options).then(function (resp) {
            if (!resp.ok) {
                return resp.text().then(function (body) {
                    throw new Error('HTTP ' + resp.status + ' ' + body.slice(0, 120));
                });
            }
            return resp.json();
        });
    }

    // ---------- overview ----------

    function renderStats(data) {
        var totals = data.totals || {};
        var cards = [
            { label: '总产出', value: totals.tasks, unit: '次' },
            { label: '今日生成', value: totals.today, unit: '次' },
            { label: '近 7 天', value: totals.week, unit: '次' },
            { label: '图片总数', value: totals.images, unit: '张' },
            { label: '收藏', value: totals.favorites, unit: '条' },
            { label: 'Token 用量', value: totals.tokens, unit: '' }
        ];
        $('statCards').innerHTML = cards.map(function (c) {
            return '<div class="tc-stat">' +
                '<div class="tc-stat-label">' + escapeHtml(c.label) + '</div>' +
                '<div class="tc-stat-value">' + num(c.value) +
                (c.unit ? '<span class="tc-stat-unit">' + escapeHtml(c.unit) + '</span>' : '') +
                '</div></div>';
        }).join('');

        // 任务标签页的计数直接取统计总量，避免首次进入显示 0
        $('taskCount').textContent = num(totals.tasks);

        // trend
        var series = data.series || [];
        var max = 1;
        series.forEach(function (p) { if (p.count > max) max = p.count; });
        $('trendHint').textContent = '近 ' + series.length + ' 天 · 峰值 ' + max + ' 次/天';
        $('trendChart').innerHTML = series.map(function (p) {
            var h = p.count > 0 ? Math.max(6, Math.round((p.count / max) * 100)) : 2;
            var label = p.date.slice(5);
            return '<div class="tc-bar-col" title="' + escapeHtml(p.date + '：' + p.count + ' 次') + '">' +
                '<div class="tc-bar' + (p.count ? '' : ' zero') + '" style="height:' + h + '%"></div>' +
                '<div class="tc-bar-label">' + escapeHtml(label) + '</div></div>';
        }).join('');

        renderDist('distType', data.by_type || [], true);
        renderDist('distProvider', data.by_provider || [], false);
        renderDist('distModel', data.by_model || [], false);

        renderRunning((data.queue || {}).items || []);
    }

    function renderDist(id, rows, translate) {
        var el = $(id);
        if (!rows.length) {
            el.innerHTML = '<div class="tc-empty">暂无数据</div>';
            return;
        }
        var max = 1;
        rows.forEach(function (r) { if (r.count > max) max = r.count; });
        el.innerHTML = rows.map(function (r) {
            var name = translate ? typeLabel(r.name) : r.name;
            var pct = Math.max(4, Math.round((r.count / max) * 100));
            return '<div class="tc-dist-row">' +
                '<div class="tc-dist-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div>' +
                '<div class="tc-dist-track"><div class="tc-dist-fill" style="width:' + pct + '%"></div></div>' +
                '<div class="tc-dist-count">' + num(r.count) + '</div></div>';
        }).join('');
    }

    function renderRunning(items) {
        var el = $('runList');
        if (!items.length) {
            el.innerHTML = '<div class="tc-empty">当前没有正在运行的任务</div>';
            return;
        }
        el.innerHTML = items.map(function (item) {
            var prompt = item.prompt || '（无提示词）';
            return '<div class="tc-run-item">' +
                '<div class="tc-run-spin"></div>' +
                '<span class="tc-thumb-badge" style="position:static;background:var(--tc-border-strong);color:var(--tc-text)">' +
                escapeHtml(typeLabel(item.type)) + '</span>' +
                '<div class="tc-run-prompt" title="' + escapeHtml(prompt) + '">' + escapeHtml(prompt) + '</div>' +
                '<div class="tc-run-meta">#' + escapeHtml(item.task_id) + ' · ' + item.elapsed + 's</div>' +
                '</div>';
        }).join('');
    }

    function loadStats() {
        return api('/api/stats/overview?days=14').then(function (data) {
            renderStats(data);
            updateLiveBadge((data.queue || {}).items || []);
        }).catch(function (err) {
            console.error('加载统计失败', err);
            $('statCards').innerHTML = '<div class="tc-empty">统计加载失败：' + escapeHtml(err.message) + '</div>';
        });
    }

    function updateLiveBadge(items) {
        var dot = $('liveDot');
        var text = $('liveText');
        if (items.length) {
            dot.classList.remove('idle');
            text.textContent = '运行中 ' + items.length;
        } else {
            dot.classList.add('idle');
            text.textContent = '空闲';
        }
    }

    // ---------- tasks ----------

    function buildQuery(reset) {
        var params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        if (state.type) params.set('type', state.type);
        if (state.providerId) params.set('provider_id', state.providerId);
        if (state.days) params.set('days', state.days);
        if (state.favoriteOnly) params.set('favorite', '1');
        params.set('sort', state.sort);
        params.set('limit', PAGE_SIZE);
        params.set('offset', reset ? 0 : state.offset);
        return params.toString();
    }

    function fillFilters(filters) {
        if (state.filtersReady || !filters) return;
        var typeSelect = $('typeSelect');
        var providerSelect = $('providerSelect');
        (filters.types || []).forEach(function (t) {
            var opt = document.createElement('option');
            opt.value = t;
            opt.textContent = typeLabel(t);
            typeSelect.appendChild(opt);
        });
        (filters.providers || []).forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            providerSelect.appendChild(opt);
        });
        state.filtersReady = true;
    }

    function loadTasks(reset) {
        if (reset) {
            state.offset = 0;
            state.items = [];
        }
        var grid = $('taskGrid');
        if (reset) grid.innerHTML = '<div class="tc-empty" style="grid-column:1/-1">加载中…</div>';
        return api('/api/tasks?' + buildQuery(reset)).then(function (data) {
            fillFilters(data.filters);
            state.total = data.total || 0;
            if (reset) {
                state.items = data.items || [];
                grid.innerHTML = '';
            } else {
                state.items = state.items.concat(data.items || []);
            }
            state.offset = state.items.length;
            renderTasks(reset ? data.items || [] : data.items || []);
            $('taskCount').textContent = num(state.total);
            $('taskEmpty').style.display = state.items.length ? 'none' : '';
            $('loadMoreWrap').style.display = state.items.length < state.total ? 'flex' : 'none';
        }).catch(function (err) {
            console.error('加载任务失败', err);
            grid.innerHTML = '<div class="tc-empty" style="grid-column:1/-1">加载失败：' + escapeHtml(err.message) + '</div>';
        });
    }

    function renderTasks(items) {
        if (!items.length) return;
        var grid = $('taskGrid');
        var html = items.map(cardHtml).join('');
        grid.insertAdjacentHTML('beforeend', html);
    }

    function cardHtml(item) {
        var thumb = item.images && item.images.length ? item.images[0] : '';
        var prompt = item.prompt || '';
        var selected = !!state.selected[item.key];
        var stars = '';
        for (var i = 1; i <= 5; i++) {
            stars += '<button class="tc-star' + (item.rating >= i ? ' on' : '') +
                '" data-act="rate" data-key="' + escapeHtml(item.key) + '" data-value="' + i +
                '" type="button" title="评 ' + i + ' 星">' + ICONS.star + '</button>';
        }
        var metaBits = [];
        if (item.model) metaBits.push(item.model);
        if (item.provider_name) metaBits.push(item.provider_name);
        if (!metaBits.length) metaBits.push(typeLabel(item.type));
        var metaHtml = metaBits.map(function (bit, idx) {
            var cls = idx === 0 ? 'tc-meta-model' : '';
            return (idx ? '<span class="tc-meta-dot">·</span>' : '') +
                '<span class="' + cls + '">' + escapeHtml(bit) + '</span>';
        }).join('');

        return '<div class="tc-card' + (selected ? ' selected' : '') + '" data-key="' + escapeHtml(item.key) + '">' +
            '<div class="tc-thumb" data-act="zoom" data-key="' + escapeHtml(item.key) + '">' +
            (thumb ? '<img loading="lazy" src="' + escapeHtml(thumb) + '" alt="">' : '') +
            '<span class="tc-thumb-badge">' + escapeHtml(typeLabel(item.type)) + '</span>' +
            (item.image_count > 1 ? '<span class="tc-thumb-count">+' + (item.image_count - 1) + '</span>' : '') +
            '<div class="tc-check" data-act="select" data-key="' + escapeHtml(item.key) + '">' + ICONS.check + '</div>' +
            '<button class="tc-fav' + (item.favorite ? ' on' : '') + '" data-act="fav" data-key="' +
            escapeHtml(item.key) + '" type="button" title="收藏">' + ICONS.heart + '</button>' +
            '</div>' +
            '<div class="tc-card-body">' +
            '<div class="tc-prompt' + (prompt ? '' : ' empty') + '" title="' + escapeHtml(prompt) + '">' +
            escapeHtml(prompt || '（无提示词）') + '</div>' +
            '<div class="tc-meta" title="' + escapeHtml(fullTime(item.timestamp)) + '">' + metaHtml +
            '<span class="tc-meta-dot">·</span><span>' + escapeHtml(relativeTime(item.timestamp)) + '</span></div>' +
            '<div class="tc-card-foot">' +
            '<div class="tc-stars">' + stars + '</div>' +
            '<div class="tc-card-actions">' +
            '<button class="tc-icon-btn" data-act="copy-prompt" data-key="' + escapeHtml(item.key) + '" type="button" title="复制提示词">' + ICONS.copy + '</button>' +
            '<button class="tc-icon-btn" data-act="copy-params" data-key="' + escapeHtml(item.key) + '" type="button" title="复制参数 JSON">' + ICONS.open + '</button>' +
            '<button class="tc-icon-btn danger" data-act="delete" data-key="' + escapeHtml(item.key) + '" type="button" title="从历史移除">' + ICONS.trash + '</button>' +
            '</div></div></div></div>';
    }

    function findItem(key) {
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].key === key) return state.items[i];
        }
        return null;
    }

    function patchCard(key, patch) {
        var item = findItem(key);
        if (item) {
            for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) item[k] = patch[k]; }
        }
        var card = document.querySelector('.tc-card[data-key="' + cssEscape(key) + '"]');
        if (!card) return;
        if (patch.favorite !== undefined) {
            var favBtn = card.querySelector('.tc-fav');
            if (favBtn) favBtn.classList.toggle('on', !!patch.favorite);
        }
        if (patch.rating !== undefined) {
            var stars = card.querySelectorAll('.tc-star');
            for (var i = 0; i < stars.length; i++) {
                stars[i].classList.toggle('on', patch.rating >= i + 1);
            }
        }
    }

    function cssEscape(value) {
        if (window.CSS && CSS.escape) return CSS.escape(value);
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function toggleFavorite(key) {
        var item = findItem(key);
        var next = !(item && item.favorite);
        return api('/api/tasks/favorite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, favorite: next })
        }).then(function (res) {
            patchCard(key, { favorite: res.favorite });
            toast(res.favorite ? '已收藏' : '已取消收藏');
        }).catch(function (err) { toast('操作失败：' + err.message); });
    }

    function setRating(key, rating) {
        var item = findItem(key);
        var next = item && item.rating === rating ? 0 : rating;
        return api('/api/tasks/rating', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, rating: next })
        }).then(function (res) {
            patchCard(key, { rating: res.rating });
        }).catch(function (err) { toast('操作失败：' + err.message); });
    }

    function deleteKeys(keys) {
        if (!keys.length) return Promise.resolve();
        return api('/api/tasks/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: keys })
        }).then(function (res) {
            keys.forEach(function (key) {
                delete state.selected[key];
                var card = document.querySelector('.tc-card[data-key="' + cssEscape(key) + '"]');
                if (card) card.remove();
            });
            state.items = state.items.filter(function (it) { return keys.indexOf(it.key) === -1; });
            state.total = Math.max(0, state.total - (res.deleted || 0));
            $('taskCount').textContent = num(state.total);
            updateSelBar();
            toast('已移除 ' + (res.deleted || 0) + ' 条记录');
            if (!state.items.length) {
                $('taskEmpty').style.display = '';
                $('loadMoreWrap').style.display = 'none';
            }
            loadStats();
        }).catch(function (err) { toast('删除失败：' + err.message); });
    }

    // ---------- selection ----------

    function updateSelBar() {
        var count = Object.keys(state.selected).length;
        $('selCount').textContent = '已选 ' + count + ' 项';
        $('selBar').classList.toggle('show', count > 0);
    }

    function toggleSelect(key) {
        if (state.selected[key]) delete state.selected[key];
        else state.selected[key] = true;
        var card = document.querySelector('.tc-card[data-key="' + cssEscape(key) + '"]');
        if (card) card.classList.toggle('selected', !!state.selected[key]);
        updateSelBar();
    }

    // ---------- lightbox ----------

    function openLightbox(key) {
        var item = findItem(key);
        if (!item || !item.images || !item.images.length) return;
        $('lightboxImg').src = item.images[0];
        $('lightboxPrompt').textContent = item.prompt || '';
        $('lightbox').classList.add('show');
    }

    function closeLightbox() {
        $('lightbox').classList.remove('show');
        $('lightboxImg').src = '';
    }

    // ---------- events ----------

    function switchTab(tab) {
        state.tab = tab;
        document.querySelectorAll('.tc-tab').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        $('pane-overview').classList.toggle('active', tab === 'overview');
        $('pane-tasks').classList.toggle('active', tab === 'tasks');
        if (tab === 'overview') loadStats();
        else loadTasks(true);
    }

    function debounce(fn, wait) {
        var timer = null;
        return function () {
            var args = arguments, ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
        };
    }

    function bind() {
        document.querySelectorAll('.tc-tab').forEach(function (btn) {
            btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
        });

        $('refreshBtn').addEventListener('click', function () {
            if (state.tab === 'overview') loadStats();
            else loadTasks(true);
            toast('已刷新');
        });

        $('searchInput').addEventListener('input', debounce(function (e) {
            state.q = e.target.value.trim();
            loadTasks(true);
        }, 280));

        $('typeSelect').addEventListener('change', function (e) {
            state.type = e.target.value;
            loadTasks(true);
        });
        $('providerSelect').addEventListener('change', function (e) {
            state.providerId = e.target.value;
            loadTasks(true);
        });
        $('daysSelect').addEventListener('change', function (e) {
            state.days = Number(e.target.value) || 0;
            loadTasks(true);
        });
        $('sortSelect').addEventListener('change', function (e) {
            state.sort = e.target.value;
            loadTasks(true);
        });
        $('favFilter').addEventListener('click', function () {
            state.favoriteOnly = !state.favoriteOnly;
            this.classList.toggle('on', state.favoriteOnly);
            loadTasks(true);
        });

        $('loadMoreBtn').addEventListener('click', function () { loadTasks(false); });

        $('selFavBtn').addEventListener('click', function () {
            var keys = Object.keys(state.selected);
            if (!keys.length) return;
            Promise.all(keys.map(function (key) {
                return api('/api/tasks/favorite', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: key, favorite: true })
                }).then(function () { patchCard(key, { favorite: true }); });
            })).then(function () {
                toast('已收藏 ' + keys.length + ' 项');
                state.selected = {};
                document.querySelectorAll('.tc-card.selected').forEach(function (c) { c.classList.remove('selected'); });
                updateSelBar();
                loadStats();
            }).catch(function (err) { toast('批量收藏失败：' + err.message); });
        });

        $('selDelBtn').addEventListener('click', function () {
            var keys = Object.keys(state.selected);
            if (!keys.length) return;
            if (!confirm('确定从历史记录中移除选中的 ' + keys.length + ' 条记录？\n\n注意：只移除历史条目，磁盘上的图片文件不会被删除。')) return;
            deleteKeys(keys);
        });

        $('selClearBtn').addEventListener('click', function () {
            state.selected = {};
            document.querySelectorAll('.tc-card.selected').forEach(function (c) { c.classList.remove('selected'); });
            updateSelBar();
        });

        $('taskGrid').addEventListener('click', function (e) {
            var target = e.target.closest('[data-act]');
            if (!target) return;
            var act = target.dataset.act;
            var key = target.dataset.key;
            if (act === 'select') { toggleSelect(key); return; }
            if (act === 'fav') { toggleFavorite(key); return; }
            if (act === 'rate') { setRating(key, Number(target.dataset.value)); return; }
            if (act === 'zoom') { openLightbox(key); return; }
            if (act === 'copy-prompt') {
                var it = findItem(key);
                copyText(it ? it.prompt : '', '提示词');
                return;
            }
            if (act === 'copy-params') {
                var it2 = findItem(key);
                if (!it2) return;
                copyText(JSON.stringify(it2.params || {}, null, 2), '参数');
                return;
            }
            if (act === 'delete') {
                if (!confirm('从历史记录中移除这条记录？\n\n注意：只移除历史条目，图片文件不会被删除。')) return;
                deleteKeys([key]);
            }
        });

        $('lightboxClose').addEventListener('click', closeLightbox);
        $('lightbox').addEventListener('click', function (e) {
            if (e.target === this) closeLightbox();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeLightbox();
        });
    }

    // ---------- boot ----------

    function boot() {
        bind();
        // 支持 ?tab=tasks 直接打开指定标签页
        var initialTab = 'overview';
        try {
            var params = new URLSearchParams(location.search);
            var requested = params.get('tab');
            if (requested === 'tasks' || requested === 'overview') initialTab = requested;
            var keyword = params.get('q');
            if (keyword) {
                state.q = keyword;
                $('searchInput').value = keyword;
            }
        } catch (e) {}
        if (initialTab === 'tasks') switchTab('tasks');
        else loadStats();
        // 运行态轻量轮询：仅刷新顶部徽标与运行列表
        setInterval(function () {
            if (document.hidden) return;
            api('/api/queue/detail').then(function (data) {
                var items = data.items || [];
                updateLiveBadge(items);
                if (state.tab === 'overview') renderRunning(items);
            }).catch(function () {});
        }, 8000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
