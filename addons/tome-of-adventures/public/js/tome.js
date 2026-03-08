/**
 * Tome of Adventures — client-side JavaScript
 */

(function() {
  var adventures = [];
  var select = document.getElementById('adventure-select');
  var importBtn = document.getElementById('import-btn');
  var preview = document.getElementById('adventure-preview');

  // Only run on the Tome page
  if (!select) return;

  // Load adventures on page load
  loadAdventures();

  function loadAdventures() {
    fetch('/tome/api/adventures')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success || !data.adventures) {
          select.innerHTML = '<option value="">Failed to load adventures</option>';
          return;
        }

        adventures = data.adventures;

        // Sort by name
        adventures.sort(function(a, b) { return a.name.localeCompare(b.name); });

        select.innerHTML = '<option value="">-- Select an adventure --</option>';
        adventures.forEach(function(adv) {
          var opt = document.createElement('option');
          opt.value = adv.id;
          var levelText = adv.level ? ' (Lvl ' + adv.level.start + '-' + adv.level.end + ')' : '';
          opt.textContent = adv.name + levelText;
          select.appendChild(opt);
        });

        select.disabled = false;
      })
      .catch(function(err) {
        select.innerHTML = '<option value="">Error: ' + err.message + '</option>';
      });
  }

  // Adventure selection
  if (select) {
    select.addEventListener('change', function() {
      var id = select.value;
      if (!id) {
        preview.style.display = 'none';
        importBtn.disabled = true;
        return;
      }

      var adv = adventures.find(function(a) { return a.id === id; });
      if (!adv) return;

      // Show preview
      document.getElementById('preview-name').textContent = adv.name;
      document.getElementById('preview-author').textContent = adv.author || '';
      document.getElementById('preview-levels').textContent = adv.level ? 'Levels ' + adv.level.start + '-' + adv.level.end : '';
      document.getElementById('preview-storyline').textContent = adv.storyline || '';

      // Chapters
      var chaptersEl = document.getElementById('preview-chapters');
      if (adv.contents && adv.contents.length > 0) {
        var html = '<ol>';
        adv.contents.forEach(function(ch) {
          html += '<li>' + (ch.name || 'Untitled') + '</li>';
        });
        html += '</ol>';
        chaptersEl.innerHTML = html;
      } else {
        chaptersEl.innerHTML = '<p class="form-hint">No chapter info available</p>';
      }

      // Check import status
      var statusEl = document.getElementById('preview-status');
      fetch('/tome/api/status/' + id)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.imported) {
            statusEl.textContent = 'Already Imported';
            statusEl.className = 'addon-badge addon-badge-installed';
            importBtn.textContent = 'Re-import';
          } else {
            statusEl.textContent = 'Not Imported';
            statusEl.className = 'addon-badge addon-badge-community';
            importBtn.textContent = 'Import';
          }
        });

      preview.style.display = '';
      importBtn.disabled = false;
    });
  }

  // Import button
  if (importBtn) {
    importBtn.addEventListener('click', function() {
      var id = select.value;
      if (!id) return;

      var adv = adventures.find(function(a) { return a.id === id; });
      if (!adv) return;

      if (!confirm('Import "' + adv.name + '"?\n\nThis will create a campaign, NPCs, and maps. This may take a few minutes.')) {
        return;
      }

      startImport(adv);
    });
  }

  var _importing = false;
  function startImport(adv) {
    if (_importing) return;
    _importing = true;
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
    select.disabled = true;

    // Show progress
    var progressDiv = document.getElementById('import-progress');
    var progressFill = document.getElementById('progress-fill');
    var progressText = document.getElementById('progress-text');
    progressDiv.style.display = '';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starting import...';

    // Start SSE for progress
    var evtSource = new EventSource('/tome/api/progress/' + adv.id);
    evtSource.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        if (data.percent >= 0) {
          progressFill.style.width = data.percent + '%';
          progressFill.textContent = data.percent + '%';
        }
        progressText.textContent = data.detail || data.step || '';

        if (data.step === 'done' && data.percent >= 100) {
          evtSource.close();
        }
      } catch (e) {}
    };
    evtSource.onerror = function() {
      evtSource.close();
    };

    // Start the import
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta ? csrfMeta.content : '';
    // Try to get CSRF from hidden input
    if (!csrfToken) {
      var csrfInput = document.querySelector('input[name="_csrf"]');
      if (csrfInput) csrfToken = csrfInput.value;
    }

    fetch('/tome/api/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        adventureId: adv.id,
        adventureName: adv.name,
        source: adv.source,
        level: adv.level,
        author: adv.author,
        storyline: adv.storyline
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      evtSource.close();

      if (data.error) {
        progressFill.style.width = '100%';
        progressFill.style.background = 'var(--error)';
        progressText.textContent = 'Error: ' + data.error;
        importBtn.disabled = false;
        importBtn.textContent = 'Retry Import';
        select.disabled = false;
        return;
      }

      progressFill.style.width = '100%';
      progressText.innerHTML = '<strong>Import complete!</strong> ' +
        (data.npcCount || 0) + ' NPCs, ' +
        (data.mapCount || 0) + ' maps created. ' +
        '<a href="/campaigns" style="color:var(--gold);">View Campaign</a>';

      importBtn.textContent = 'Import Complete';

      // Reload page after short delay to update imports list
      setTimeout(function() {
        window.location.reload();
      }, 3000);
    })
    .catch(function(err) {
      evtSource.close();
      progressText.textContent = 'Error: ' + (err.message || 'Network error');
      progressFill.style.background = 'var(--error)';
      importBtn.disabled = false;
      importBtn.textContent = 'Retry Import';
      select.disabled = false;
    });
  }

  // Re-import from previously imported list
  window.reimportAdventure = function(adventureId, adventureName) {
    if (!confirm('Re-import "' + adventureName + '"?\n\nThis will update the existing campaign and add any new NPCs/maps without removing your changes.')) {
      return;
    }

    // Set the select and trigger import
    if (select) {
      select.value = adventureId;
      select.dispatchEvent(new Event('change'));
      setTimeout(function() {
        var adv = adventures.find(function(a) { return a.id === adventureId; });
        if (adv) {
          startImport(adv);
        } else {
          // Adventure not in list yet — construct minimal metadata
          startImport({
            id: adventureId,
            name: adventureName,
            source: adventureId,
            level: null,
            author: 'Wizards of the Coast',
            storyline: ''
          });
        }
      }, 500);
    }
  };

  // Delete import record + campaign + NPCs + maps
  window.deleteImport = function(adventureId, adventureName) {
    if (!confirm('Delete "' + adventureName + '"?\n\nThis will remove the campaign, imported NPCs, and maps. This cannot be undone.')) {
      return;
    }

    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta ? csrfMeta.content : '';
    if (!csrfToken) {
      var csrfInput = document.querySelector('input[name="_csrf"]');
      if (csrfInput) csrfToken = csrfInput.value;
    }

    fetch('/tome/api/import/' + adventureId, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        window.location.reload();
      } else {
        alert('Error: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(function(err) {
      alert('Error: ' + err.message);
    });
  };

  // --- Map Hierarchy Editor ---
  var _editorCampaignId = null;
  var _editorMaps = [];
  var _editorOtherMaps = [];

  function getCsrf() {
    var el = document.querySelector('meta[name="csrf-token"]');
    if (el) return el.content;
    el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  window.openMapEditor = function(campaignId) {
    _editorCampaignId = campaignId;
    var overlay = document.getElementById('map-editor-overlay');
    var list = document.getElementById('map-editor-list');
    overlay.style.display = 'flex';
    list.innerHTML = '<p class="form-hint">Loading maps...</p>';

    fetch('/tome/api/maps/' + campaignId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) { list.innerHTML = '<p>Error loading maps</p>'; return; }
        _editorMaps = data.maps;
        _editorOtherMaps = data.otherMaps;
        renderMapEditor();
      })
      .catch(function(err) {
        list.innerHTML = '<p>Error: ' + err.message + '</p>';
      });
  };

  window.closeMapEditor = function() {
    document.getElementById('map-editor-overlay').style.display = 'none';
  };

  function renderMapEditor() {
    var list = document.getElementById('map-editor-list');
    // All maps = campaign maps + other maps, usable as parents
    var allMaps = _editorMaps.concat(_editorOtherMaps);

    var html = '';
    for (var i = 0; i < _editorMaps.length; i++) {
      var m = _editorMaps[i];
      html += '<div class="tome-map-row">';
      html += '<span class="map-name" title="' + escHtml(m.name) + '">' + escHtml(m.name) + '</span>';
      html += '<span class="parent-label">Parent:</span>';
      html += '<select data-map-id="' + m.id + '" class="map-parent-select">';
      html += '<option value="">— None (top level) —</option>';

      for (var j = 0; j < allMaps.length; j++) {
        var p = allMaps[j];
        if (p.id === m.id) continue; // Can't be parent of self
        var sel = (m.parent_id === p.id) ? ' selected' : '';
        html += '<option value="' + p.id + '"' + sel + '>' + escHtml(p.name) + '</option>';
      }

      html += '</select>';
      html += '</div>';
    }

    list.innerHTML = html || '<p class="form-hint">No maps found for this campaign.</p>';
  }

  window.saveMapHierarchy = function() {
    var selects = document.querySelectorAll('.map-parent-select');
    var updates = [];
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      updates.push({
        id: parseInt(sel.getAttribute('data-map-id')),
        parent_id: sel.value ? parseInt(sel.value) : null
      });
    }

    var btn = document.getElementById('save-maps-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    fetch('/tome/api/maps/hierarchy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrf()
      },
      body: JSON.stringify({ updates: updates })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.textContent = 'Save';
      if (data.success) {
        closeMapEditor();
      } else {
        alert('Error: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Save';
      alert('Error: ' + err.message);
    });
  };

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
