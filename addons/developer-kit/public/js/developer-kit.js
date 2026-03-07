/* Addon Developer Kit — Client-Side JavaScript */

document.addEventListener('DOMContentLoaded', function() {
  // Tab switching
  document.querySelectorAll('.addons-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.addons-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.addons-tab-content').forEach(function(c) { c.style.display = 'none'; });
      tab.classList.add('active');
      var target = document.getElementById('tab-' + tab.dataset.tab);
      if (target) target.style.display = '';
    });
  });

  // Load first doc on page load
  loadDoc('creating-addons');

  // Doc nav links
  document.querySelectorAll('.devkit-doc-link').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      document.querySelectorAll('.devkit-doc-link').forEach(function(l) { l.classList.remove('active'); });
      link.classList.add('active');
      loadDoc(link.dataset.doc);
    });
  });

  // Scaffolder — auto-slug from name
  var nameInput = document.getElementById('sc-name');
  var idInput = document.getElementById('sc-id');
  if (nameInput && idInput) {
    nameInput.addEventListener('input', function() {
      idInput.value = nameInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      updatePreview();
    });
    // Update preview on any field change
    ['sc-name', 'sc-id', 'sc-version', 'sc-author', 'sc-description', 'sc-category', 'sc-icon'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePreview);
      if (el) el.addEventListener('change', updatePreview);
    });
  }

  // Scaffold form submit
  var scaffoldForm = document.getElementById('scaffold-form');
  if (scaffoldForm) {
    scaffoldForm.addEventListener('submit', function(e) {
      e.preventDefault();
      generateScaffold();
    });
  }

  // Validator drag & drop
  var dropzone = document.getElementById('validate-dropzone');
  var fileInput = document.getElementById('validate-file');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', function() { fileInput.click(); });
    dropzone.addEventListener('dragover', function(e) { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', function() { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        validateFile(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener('change', function() {
      if (fileInput.files.length > 0) {
        validateFile(fileInput.files[0]);
      }
    });
  }
});

// --- Documentation ---
function loadDoc(name) {
  var content = document.getElementById('doc-content');
  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Loading...</div>';

  fetch('/developer-kit/docs/' + name)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        content.innerHTML = '<p style="color:var(--error);">' + data.error + '</p>';
        return;
      }
      content.innerHTML = renderMarkdown(data.content);
    })
    .catch(function() {
      content.innerHTML = '<p style="color:var(--error);">Failed to load documentation.</p>';
    });
}

// Simple markdown to HTML renderer
function renderMarkdown(md) {
  var html = md;

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
    return '<pre><code class="lang-' + lang + '">' + escapeHtml(code.trim()) + '</code></pre>';
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, function(match, header, sep, body) {
    var headers = header.split('|').filter(function(c) { return c.trim(); });
    var rows = body.trim().split('\n');
    var table = '<table><thead><tr>';
    headers.forEach(function(h) { table += '<th>' + h.trim() + '</th>'; });
    table += '</tr></thead><tbody>';
    rows.forEach(function(row) {
      var cols = row.split('|').filter(function(c) { return c.trim(); });
      table += '<tr>';
      cols.forEach(function(c) { table += '<td>' + c.trim() + '</td>'; });
      table += '</tr>';
    });
    table += '</tbody></table>';
    return table;
  });

  // Unordered lists
  var lines = html.split('\n');
  var result = [];
  var inList = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^- (.+)/.test(line)) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push('<li>' + line.replace(/^- /, '') + '</li>');
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      if (line.trim() === '') {
        result.push('<br>');
      } else {
        result.push(line);
      }
    }
  }
  if (inList) result.push('</ul>');
  html = result.join('\n');

  // Numbered lists
  lines = html.split('\n');
  result = [];
  inList = false;
  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (/^\d+\. (.+)/.test(line)) {
      if (!inList) { result.push('<ol>'); inList = true; }
      result.push('<li>' + line.replace(/^\d+\. /, '') + '</li>');
    } else {
      if (inList) { result.push('</ol>'); inList = false; }
      result.push(line);
    }
  }
  if (inList) result.push('</ol>');
  html = result.join('\n');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Scaffolder ---
function generateScaffold() {
  var btn = document.getElementById('scaffold-btn');
  var name = document.getElementById('sc-name').value.trim();
  var id = document.getElementById('sc-id').value.trim();
  if (!name || !id) { alert('Name and ID are required.'); return; }

  btn.disabled = true;
  btn.textContent = 'Generating...';

  var config = {
    id: id,
    name: name,
    version: document.getElementById('sc-version').value || '1.0.0',
    author: document.getElementById('sc-author').value || 'Your Name',
    description: document.getElementById('sc-description').value || '',
    category: document.getElementById('sc-category').value,
    icon: document.getElementById('sc-icon').value,
    includeRoutes: document.getElementById('sc-routes').checked,
    includeMigrations: document.getElementById('sc-migrations').checked,
    includeCss: document.getElementById('sc-css').checked,
    includeJs: document.getElementById('sc-js').checked,
    includeWidget: document.getElementById('sc-widget').checked
  };

  fetch('/developer-kit/scaffold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  })
  .then(function(response) {
    if (!response.ok) throw new Error('Server error');
    return response.blob();
  })
  .then(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = id + '-' + (config.version || '1.0.0') + '.qpa';
    a.click();
    URL.revokeObjectURL(url);
    btn.disabled = false;
    btn.textContent = 'Generate .qpa Package';
  })
  .catch(function(err) {
    alert('Failed to generate package: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Generate .qpa Package';
  });
}

// --- Validator ---
function validateFile(file) {
  var resultsDiv = document.getElementById('validate-results');
  var summaryDiv = document.getElementById('validate-summary');
  var checksDiv = document.getElementById('validate-checks');
  var warningsDiv = document.getElementById('validate-warnings');
  var errorsDiv = document.getElementById('validate-errors');

  resultsDiv.style.display = '';
  summaryDiv.innerHTML = '<span style="color:var(--text-secondary);">Validating ' + file.name + '...</span>';
  checksDiv.innerHTML = '';
  warningsDiv.innerHTML = '';
  errorsDiv.innerHTML = '';

  var formData = new FormData();
  formData.append('addon_package', file);

  fetch('/developer-kit/validate', {
    method: 'POST',
    body: formData
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) {
      summaryDiv.innerHTML = '<span style="color:var(--error);">' + data.error + '</span>';
      return;
    }

    // Summary
    var passCount = 0, failCount = 0;
    (data.checks || []).forEach(function(c) { c.pass ? passCount++ : failCount++; });
    var warnCount = (data.warnings || []).length;
    var errCount = (data.errors || []).length;

    var summaryHtml = '';
    if (data.manifest) {
      summaryHtml += '<strong>' + data.manifest.name + '</strong> v' + data.manifest.version + ' by ' + data.manifest.author + '<br>';
    }
    summaryHtml += '<span class="devkit-check-pass">' + passCount + ' passed</span>';
    if (failCount > 0) summaryHtml += ' &middot; <span class="devkit-check-fail">' + failCount + ' failed</span>';
    if (warnCount > 0) summaryHtml += ' &middot; <span style="color:rgb(255,193,7);">' + warnCount + ' warning(s)</span>';
    if (errCount > 0) summaryHtml += ' &middot; <span class="devkit-check-fail">' + errCount + ' error(s)</span>';
    summaryDiv.innerHTML = summaryHtml;

    // Checks
    var checksHtml = '';
    (data.checks || []).forEach(function(c) {
      var icon = c.pass ? '<span class="devkit-check-pass">&#10003;</span>' : '<span class="devkit-check-fail">&#10007;</span>';
      var detail = c.detail ? ' <span class="devkit-check-detail">(' + c.detail + ')</span>' : '';
      checksHtml += '<div class="devkit-check-item">' + icon + ' ' + c.name + detail + '</div>';
    });
    checksDiv.innerHTML = checksHtml;

    // Warnings
    if (data.warnings && data.warnings.length > 0) {
      var wHtml = '<h4 style="font-size:0.85rem;margin-bottom:0.5rem;color:rgb(255,193,7);">Warnings</h4>';
      data.warnings.forEach(function(w) { wHtml += '<div class="devkit-warning-item">' + w + '</div>'; });
      warningsDiv.innerHTML = wHtml;
    }

    // Errors
    if (data.errors && data.errors.length > 0) {
      var eHtml = '<h4 style="font-size:0.85rem;margin-bottom:0.5rem;color:var(--error);">Errors</h4>';
      data.errors.forEach(function(e) { eHtml += '<div class="devkit-error-item">' + e + '</div>'; });
      errorsDiv.innerHTML = eHtml;
    }
  })
  .catch(function() {
    summaryDiv.innerHTML = '<span style="color:var(--error);">Validation request failed.</span>';
  });
}

// --- Preview ---
function updatePreview() {
  var name = document.getElementById('sc-name').value || 'Your Addon Name';
  var version = document.getElementById('sc-version').value || '1.0.0';
  var author = document.getElementById('sc-author').value || 'Your Name';
  var desc = document.getElementById('sc-description').value || 'Your addon description will appear here.';
  var category = document.getElementById('sc-category').value || 'Gameplay';
  var id = document.getElementById('sc-id').value || 'your-addon';

  var nameEl = document.getElementById('preview-name');
  var versionEl = document.getElementById('preview-version');
  var authorEl = document.getElementById('preview-author');
  var descEl = document.getElementById('preview-description');
  var categoryEl = document.getElementById('preview-category');

  if (nameEl) nameEl.textContent = name;
  if (versionEl) versionEl.textContent = 'v' + version;
  if (authorEl) authorEl.textContent = 'by ' + author;
  if (descEl) descEl.textContent = desc;
  if (categoryEl) categoryEl.textContent = category;

  // Update registry JSON
  var entry = {
    id: id,
    name: name,
    version: version,
    author: author,
    description: desc,
    category: category,
    type: 'community',
    minAppVersion: '3.0.0',
    downloadUrl: 'https://github.com/YOUR-USERNAME/YOUR-REPO/raw/main/packages/' + id + '-' + version + '.qpa',
    repository: 'https://github.com/YOUR-USERNAME/' + id
  };

  var jsonEl = document.getElementById('preview-registry-json');
  if (jsonEl) jsonEl.textContent = JSON.stringify(entry, null, 2);
}

function copyRegistryEntry() {
  var text = document.getElementById('preview-registry-json').textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = event.target;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy to Clipboard'; }, 2000);
  });
}
