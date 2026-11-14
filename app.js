(function(){
  "use strict";

  // ===================== AUTH (Netlify Identity) =====================

  function showAuthStatus(message){
    var box = document.getElementById("auth-status");
    box.textContent = message;
    box.hidden = !message;
  }

  document.getElementById("open-login").addEventListener("click", function(){
    netlifyIdentity.open("login");
  });
  document.getElementById("open-signup").addEventListener("click", function(){
    netlifyIdentity.open("signup");
  });
  document.getElementById("logout-btn").addEventListener("click", function(){
    netlifyIdentity.logout();
  });

  function showApp(user){
    document.getElementById("auth-view").hidden = true;
    document.getElementById("app-view").hidden = false;
    document.getElementById("account-email").textContent = (user && user.email) || "";
    startApp();
  }
  function showAuth(){
    document.getElementById("app-view").hidden = true;
    document.getElementById("auth-view").hidden = false;
    stopApp();
  }

  netlifyIdentity.on("init", function(user){
    if (user) showApp(user); else showAuth();
  });
  netlifyIdentity.on("login", function(user){
    netlifyIdentity.close();
    showApp(user);
  });
  netlifyIdentity.on("logout", function(){
    showAuth();
  });
  netlifyIdentity.on("error", function(err){
    showAuthStatus("Erro: " + (err && err.message ? err.message : "algo deu errado. Tente de novo."));
  });
  netlifyIdentity.init();

  // ===================== DADOS (Netlify Function + Blobs) =====================

  function apiRequest(method, body){
    var user = netlifyIdentity.currentUser();
    if (!user) return Promise.reject(new Error("not_authenticated"));
    return user.jwt().then(function(token){
      return fetch("/.netlify/functions/grades", {
        method: method,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });
    }).then(function(res){
      if (!res.ok) throw new Error("api_error_" + res.status);
      return res.json();
    });
  }

  function loadSubjects(){ return apiRequest("GET"); }
  function saveSubjects(){
    return apiRequest("PUT", { subjects: state.subjects }).catch(function(err){
      console.error("Erro salvando notas:", err);
      setSyncError("Não foi possível salvar agora. Suas últimas mudanças podem não ter sido guardadas — verifique sua internet.");
    });
  }
  function setSyncError(message){
    var box = document.getElementById("sync-note");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
  }

  // ===================== GRADE CALCULATOR =====================

  var state = {
    subjects: [],
    activeSubjectId: null,
    activeTab: "historico",
    showNewSubjectForm: false,
    confirmDeleteId: null
  };

  // Seed data mirrors a points-based grading sheet (ex: "Histología I"),
  // written as real, editable, deletable subjects the first time someone
  // logs in with no data yet.
  var SEED_SUBJECTS = [
    { name: "Histología I (exemplo)", maxPoints: 100, targetPercent: 60, exams: [
      { name: "Parcial 1", date: "2025-03-26", points: 16 },
      { name: "Parcial recuperatorio 2", date: "2025-06-25", points: 9 },
      { name: "Examen final", date: "2025-07-16", points: 29 },
      { name: "Proceso integrado", date: "2025-06-23", points: 7 }
    ]},
    { name: "Anatomia II (exemplo)", maxPoints: 100, targetPercent: 60, exams: [
      { name: "Parcial 1", date: "2025-04-02", points: 22 },
      { name: "Parcial 2", date: "2025-05-14", points: 18 }
    ]}
  ];

  function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  function cloneSeedSubject(s){
    return {
      id: uid(),
      name: s.name,
      maxPoints: s.maxPoints,
      targetPercent: s.targetPercent,
      exams: s.exams.map(function(e){ return Object.assign({ id: uid() }, e); })
    };
  }

  function startApp(){
    state.activeSubjectId = null;
    setSyncError(null);
    loadSubjects().then(function(data){
      state.subjects = (data && Array.isArray(data.subjects)) ? data.subjects : [];

      if (!state.subjects.length){
        state.subjects = SEED_SUBJECTS.map(cloneSeedSubject);
        saveSubjects();
      }

      if (!state.activeSubjectId && state.subjects.length){
        state.activeSubjectId = state.subjects[0].id;
      }
      render();
    }).catch(function(err){
      console.error("Erro carregando notas:", err);
      state.subjects = [];
      render();
      setSyncError("Não foi possível carregar suas notas agora. Recarregue a página ou tente de novo em instantes.");
    });
  }

  function stopApp(){
    state.subjects = [];
    state.activeSubjectId = null;
  }

  function fmt(n, decimals){
    if (n === null || n === undefined || isNaN(n)) return "—";
    var d = decimals === undefined ? 1 : decimals;
    var r = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return r % 1 === 0 ? String(r) : r.toFixed(d);
  }
  function fmtDate(iso){
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function computeSubjectStats(subject){
    var exams = subject.exams || [];
    var sum = exams.reduce(function(a, ex){ return a + (Number(ex.points) || 0); }, 0);
    var max = Number(subject.maxPoints) || 0;
    var target = Number(subject.targetPercent);
    if (isNaN(target)) target = 60;
    var percent = max ? (sum / max) * 100 : null;
    var status = !exams.length ? "neutral" : (percent !== null && percent >= target ? "ok" : "bad");
    var neededPoints = max * target / 100;
    var missing = neededPoints - sum;
    return { sum: sum, max: max, percent: percent, target: target, status: status, missing: missing };
  }

  function addSubject(name, maxPoints, targetPercent){
    var subject = { id: uid(), name: name, maxPoints: maxPoints, targetPercent: targetPercent, exams: [] };
    state.subjects.push(subject);
    state.activeSubjectId = subject.id;
    saveSubjects();
    render();
  }
  function updateSubject(subjectId, patch){
    var s = state.subjects.find(function(x){ return x.id === subjectId; });
    if (!s) return;
    Object.assign(s, patch);
    saveSubjects();
    render();
  }
  function deleteSubject(subjectId){
    state.subjects = state.subjects.filter(function(x){ return x.id !== subjectId; });
    if (state.activeSubjectId === subjectId) state.activeSubjectId = null;
    saveSubjects();
    render();
  }
  function addExam(subject, exam){
    var exams = (subject.exams || []).concat([Object.assign({ id: uid() }, exam)]);
    updateSubject(subject.id, { exams: exams });
  }
  function removeExam(subject, examId){
    var exams = (subject.exams || []).filter(function(e){ return e.id !== examId; });
    updateSubject(subject.id, { exams: exams });
  }

  // ---------- rendering ----------
  function el(html){
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, function(c){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderTabs(){
    document.querySelectorAll(".tab").forEach(function(btn){
      btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
    });
    document.getElementById("panel-historico").hidden = state.activeTab !== "historico";
    document.getElementById("panel-geral").hidden = state.activeTab !== "geral";
  }

  function renderHistorico(){
    var panel = document.getElementById("panel-historico");
    panel.innerHTML = "";

    var subjects = state.subjects;

    var chipRow = el('<div class="subject-row" id="chip-row"></div>');
    subjects.forEach(function(s){
      var isActive = s.id === state.activeSubjectId || (!state.activeSubjectId && subjects[0] && subjects[0].id === s.id);
      var wrap = el(
        '<span class="chip-wrap' + (isActive ? ' active' : '') + '">' +
          '<button type="button" class="chip-select">' + escapeHtml(s.name) + '</button>' +
        '</span>'
      );
      wrap.querySelector(".chip-select").addEventListener("click", function(){
        state.activeSubjectId = s.id;
        render();
      });
      var delChip = el('<button type="button" class="chip-del" aria-label="Remover ' + escapeHtml(s.name) + '" title="Remover disciplina">×</button>');
      delChip.addEventListener("click", function(ev){
        ev.stopPropagation();
        state.activeSubjectId = s.id;
        state.confirmDeleteId = s.id;
        render();
      });
      wrap.appendChild(delChip);
      chipRow.appendChild(wrap);
    });
    var addChip = el('<button type="button" class="chip add">+ Nova disciplina</button>');
    addChip.addEventListener("click", function(){
      state.showNewSubjectForm = !state.showNewSubjectForm;
      render();
    });
    chipRow.appendChild(addChip);
    panel.appendChild(chipRow);

    if (state.showNewSubjectForm){
      panel.appendChild(renderNewSubjectForm());
    }

    var activeId = state.activeSubjectId || (subjects[0] && subjects[0].id);
    var subject = subjects.find(function(s){ return s.id === activeId; }) || subjects[0];
    if (subject){
      panel.appendChild(renderSubjectCard(subject));
    }
  }

  function renderNewSubjectForm(){
    var wrap = el(
      '<div class="card">' +
        '<form class="new-subject-form" id="new-subject-form">' +
          '<div class="field">' +
            '<label for="new-subject-name">Nome da disciplina</label>' +
            '<input type="text" id="new-subject-name" placeholder="Ex: Histología I" required>' +
          '</div>' +
          '<div class="field">' +
            '<label for="new-subject-max">Pontuação máxima</label>' +
            '<input type="number" id="new-subject-max" value="100" min="1" step="1" style="width:84px">' +
          '</div>' +
          '<div class="field">' +
            '<label for="new-subject-target">Meta p/ aprovar (%)</label>' +
            '<input type="number" id="new-subject-target" value="60" min="0" max="100" step="1" style="width:72px">' +
          '</div>' +
          '<button type="submit" class="primary-btn">Adicionar</button>' +
        '</form>' +
      '</div>'
    );
    wrap.querySelector("form").addEventListener("submit", function(ev){
      ev.preventDefault();
      var name = document.getElementById("new-subject-name").value.trim();
      var maxPoints = parseFloat(document.getElementById("new-subject-max").value);
      var targetPercent = parseFloat(document.getElementById("new-subject-target").value);
      if (!name) return;
      addSubject(name, isNaN(maxPoints) ? 100 : maxPoints, isNaN(targetPercent) ? 60 : targetPercent);
      state.showNewSubjectForm = false;
      render();
    });
    return wrap;
  }

  function renderSubjectCard(subject){
    var stats = computeSubjectStats(subject);
    var card = el('<div class="card"></div>');

    var head = el(
      '<div class="subject-head">' +
        '<div>' +
          '<h2>' + escapeHtml(subject.name) + '</h2>' +
          '<div class="sub">Meta: ' + fmt(stats.target, 0) + '% de ' + fmt(stats.max, 0) + ' pontos (' + fmt(stats.max * stats.target / 100, 1) + ' pts)</div>' +
        '</div>' +
      '</div>'
    );

    var metaWrap = el('<div class="meta-fields"></div>');
    var maxField = el(
      '<label class="meta-field" for="max-' + subject.id + '">Máx. <input type="number" id="max-' + subject.id + '" min="1" step="1" value="' + stats.max + '"></label>'
    );
    var targetField = el(
      '<label class="meta-field" for="target-' + subject.id + '">Meta % <input type="number" id="target-' + subject.id + '" min="0" max="100" step="1" value="' + stats.target + '"></label>'
    );
    maxField.querySelector("input").addEventListener("change", function(ev){
      var v = parseFloat(ev.target.value);
      updateSubject(subject.id, { maxPoints: isNaN(v) ? 100 : v });
    });
    targetField.querySelector("input").addEventListener("change", function(ev){
      var v = parseFloat(ev.target.value);
      updateSubject(subject.id, { targetPercent: isNaN(v) ? 60 : v });
    });
    metaWrap.appendChild(maxField);
    metaWrap.appendChild(targetField);
    head.appendChild(metaWrap);
    card.appendChild(head);

    if (state.confirmDeleteId === subject.id){
      var confirmBox = el(
        '<div class="confirm-del">' +
          '<p>Apagar "' + escapeHtml(subject.name) + '" e todas as suas notas? Essa ação não pode ser desfeita.</p>' +
          '<button type="button" class="danger-btn">Sim, apagar</button>' +
          '<button type="button" class="ghost-btn">Cancelar</button>' +
        '</div>'
      );
      confirmBox.querySelector(".danger-btn").addEventListener("click", function(){
        state.confirmDeleteId = null;
        deleteSubject(subject.id);
      });
      confirmBox.querySelector(".ghost-btn").addEventListener("click", function(){
        state.confirmDeleteId = null;
        render();
      });
      card.appendChild(confirmBox);
    } else {
      var deleteSubjectBtn = el('<button type="button" class="link-del">Apagar disciplina</button>');
      deleteSubjectBtn.addEventListener("click", function(){
        state.confirmDeleteId = subject.id;
        render();
      });
      card.appendChild(deleteSubjectBtn);
    }

    var table = el(
      '<table class="exams"><thead><tr><th>Avaliação</th><th>Data</th><th style="text-align:right">Pontos</th><th></th></tr></thead><tbody></tbody></table>'
    );
    var tbody = table.querySelector("tbody");
    (subject.exams || []).forEach(function(ex){
      var row = el(
        '<tr>' +
          '<td>' + escapeHtml(ex.name) + '</td>' +
          '<td class="date">' + (ex.date ? fmtDate(ex.date) : "—") + '</td>' +
          '<td class="num">' + fmt(ex.points) + '</td>' +
          '<td></td>' +
        '</tr>'
      );
      var rmBtn = el('<button type="button" class="icon-btn" aria-label="Remover avaliação" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg></button>');
      rmBtn.addEventListener("click", function(){ removeExam(subject, ex.id); });
      row.lastElementChild.appendChild(rmBtn);
      tbody.appendChild(row);
    });
    if (!subject.exams || !subject.exams.length){
      tbody.appendChild(el('<tr><td colspan="4" style="color:var(--muted);">Nenhuma avaliação lançada ainda.</td></tr>'));
    }
    card.appendChild(table);

    var formIdBase = "exam-" + subject.id;
    var form = el(
      '<form class="add-exam-form" id="' + formIdBase + '-form">' +
        '<input type="text" id="' + formIdBase + '-name" placeholder="Ex: Parcial 1" required>' +
        '<input type="date" id="' + formIdBase + '-date">' +
        '<input type="number" id="' + formIdBase + '-points" placeholder="Pontos" step="0.1" min="0" required>' +
        '<button type="submit" aria-label="Adicionar avaliação" title="Adicionar">+</button>' +
      '</form>'
    );
    form.addEventListener("submit", function(ev){
      ev.preventDefault();
      var nameEl = document.getElementById(formIdBase + "-name");
      var dateEl = document.getElementById(formIdBase + "-date");
      var pointsEl = document.getElementById(formIdBase + "-points");
      var name = nameEl.value.trim();
      var points = parseFloat(pointsEl.value);
      if (!name || isNaN(points)) return;
      addExam(subject, { name: name, date: dateEl.value || null, points: points });
      var freshNameEl = document.getElementById(formIdBase + "-name");
      if (freshNameEl) freshNameEl.focus();
    });
    card.appendChild(form);

    var statusLabel = stats.status === "ok" ? "Atingiu a meta" : stats.status === "bad" ? "Abaixo da meta" : "Sem notas";
    var missingNote = stats.status === "bad" && stats.missing > 0 ? "Faltam " + fmt(stats.missing) + " pts" : "";
    var statsRow = el(
      '<div class="stats-row">' +
        '<div class="stat"><div class="label">Soma</div><div class="value">' + fmt(stats.sum) + ' / ' + fmt(stats.max, 0) + '</div></div>' +
        '<div class="stat"><div class="label">% atingido</div><div class="value">' + (stats.percent === null ? "—" : fmt(stats.percent, 1) + "%") + '</div></div>' +
        '<div class="stat"><div class="label">Situação</div><div class="pill ' + stats.status + '">' + statusLabel + '</div>' + (missingNote ? '<div class="note">' + missingNote + '</div>' : '') + '</div>' +
      '</div>'
    );
    card.appendChild(statsRow);

    return card;
  }

  function renderGeral(){
    var panel = document.getElementById("panel-geral");
    panel.innerHTML = "";

    var subjects = state.subjects;

    var withStats = subjects.map(function(s){ return { subject: s, stats: computeSubjectStats(s) }; });
    var withPercent = withStats.filter(function(x){ return x.stats.percent !== null; });
    var overallPercent = withPercent.length
      ? withPercent.reduce(function(a, x){ return a + x.stats.percent; }, 0) / withPercent.length
      : null;

    var heroCard = el(
      '<div class="card">' +
        '<div class="overall-hero">' +
          '<div class="big">' + (overallPercent === null ? "—" : fmt(overallPercent, 1) + "%") + '</div>' +
          '<div class="meta">Média do % atingido entre ' + withPercent.length + ' disciplina' + (withPercent.length === 1 ? '' : 's') + '</div>' +
        '</div>' +
      '</div>'
    );
    panel.appendChild(heroCard);

    var listCard = el('<div class="card"><div class="subject-summary-list" id="summary-list"></div></div>');
    var list = listCard.querySelector("#summary-list");
    withStats.forEach(function(x){
      var pct = x.stats.percent === null ? 0 : Math.max(0, Math.min(100, x.stats.percent));
      var statusLabel = x.stats.status === "ok" ? "Atingiu" : x.stats.status === "bad" ? "Abaixo" : "—";
      var missingHtml = "";
      if (x.stats.status === "ok"){
        missingHtml = '<div class="missing-note ok">Meta batida ✓</div>';
      } else if (x.stats.status === "bad" && x.stats.missing > 0){
        missingHtml = '<div class="missing-note">Faltam ' + fmt(x.stats.missing) + ' pts p/ meta de ' + fmt(x.stats.target, 0) + '%</div>';
      }
      var row = el(
        '<div class="subject-summary-row">' +
          '<div class="left">' +
            '<div class="row-top">' +
              '<span class="name">' + escapeHtml(x.subject.name) + '</span>' +
              '<span class="meta-tag">Meta ' + fmt(x.stats.target, 0) + '%</span>' +
            '</div>' +
            '<div class="bar-wrap">' +
              '<div class="bar" style="width:' + pct + '%"></div>' +
              '<div class="target-line" style="left:' + Math.max(0, Math.min(100, x.stats.target)) + '%"></div>' +
            '</div>' +
            missingHtml +
          '</div>' +
          '<span class="pill ' + x.stats.status + '">' + statusLabel + '</span>' +
          '<span class="avg">' + (x.stats.percent === null ? "—" : fmt(x.stats.percent, 0) + "%") + '</span>' +
        '</div>'
      );
      list.appendChild(row);
    });
    panel.appendChild(listCard);
  }

  function render(){
    renderTabs();
    renderHistorico();
    renderGeral();
  }

  document.querySelectorAll(".tab").forEach(function(btn){
    btn.addEventListener("click", function(){
      state.activeTab = btn.dataset.tab;
      render();
    });
  });
})();
