const explicitApiBase = window.TRACKER_API_BASE_URL
    || window.localStorage.getItem("trackerApiBaseUrl")
    || document.querySelector('meta[name="api-base-url"]')?.content;

const configuredApiBase = explicitApiBase
    || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:8080"
        : "https://project3-backend-1-y1d6.onrender.com");

const API_BASE = configuredApiBase.replace(/\/$/, "");
let currentUser = null;

function apiUrl(path) {
    if (/^https?:\/\//.test(path)) {
        return path;
    }
    return `${API_BASE}${path}`;
}

async function request(url, options = {}) {
    const response = await fetch(apiUrl(url), {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...options
    });
    if (!response.ok) {
        let message = "Request failed";
        try {
            const body = await response.json();
            message = body.error || body.message || JSON.stringify(body);
        } catch (error) {
            message = response.statusText;
        }
        throw new Error(message);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function initUserSession() {
    const nav = document.querySelector("header nav");
    if (!nav) {
        return;
    }
    const users = await request("/api/users");
    const wrapper = document.createElement("label");
    wrapper.style.marginLeft = "auto";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "0.4rem";
    wrapper.style.color = "#dbeafe";
    wrapper.textContent = "User";
    const select = document.createElement("select");
    select.id = "login-user-select";
    select.style.padding = "0.25rem 0.4rem";
    select.innerHTML = users.map(user =>
        `<option value="${user.id}" ${user.current ? "selected" : ""}>${escapeHtml(user.username)} (${user.role})</option>`
    ).join("");
    select.addEventListener("change", async () => {
        await request("/api/login", {
            method: "POST",
            body: JSON.stringify({ userId: Number(select.value) })
        });
        currentUser = users.find(user => user.id === Number(select.value)) || null;
        await loadLogsPage();
    });
    wrapper.appendChild(select);
    nav.appendChild(wrapper);
    currentUser = users.find(user => user.current) || users[0] || null;
}

function setMessage(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }
    element.textContent = message;
    element.className = isError ? "message error" : "message";
}

function toIsoOrNull(localValue) {
    return localValue ? new Date(localValue).toISOString().slice(0, 19) : null;
}


function formatDatetimeLocal(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDefaultApplicabilityInputs() {
    const value = formatDatetimeLocal(new Date());
    document.querySelectorAll('input[name="applicabilityTime"]').forEach(input => {
        input.value = value;
    });
}

function escapeHtml(text) {
    if (text == null || text === undefined) {
        return "";
    }
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
}

function formatDateTime(iso) {
    if (!iso) {
        return "—";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return escapeHtml(String(iso));
    }
    return escapeHtml(date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
}

async function loadIndexPage() {
    const patientTable = document.getElementById("patient-table");
    if (!patientTable) {
        return;
    }

    async function refreshPatients() {
        const patients = await request("/api/patients");
        patientTable.innerHTML = patients.map(patient => `
            <tr>
                <td>${escapeHtml(String(patient.id))}</td>
                <td>${escapeHtml(patient.fullName)}</td>
                <td>${escapeHtml(patient.dateOfBirth)}</td>
                <td>${patient.note ? escapeHtml(patient.note) : "—"}</td>
                <td><a href="patient.html?id=${patient.id}">Open</a></td>
            </tr>
        `).join("");
    }

    document.getElementById("patient-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.target;
        try {
            await request("/api/patients", {
                method: "POST",
                body: JSON.stringify({
                    fullName: form.fullName.value,
                    dateOfBirth: form.dateOfBirth.value,
                    note: form.note.value
                })
            });
            form.reset();
            setMessage("patient-message", "Patient created");
            await refreshPatients();
        } catch (error) {
            setMessage("patient-message", error.message, true);
        }
    });

    await refreshPatients();
}

async function loadCataloguePage() {
    const quantTable = document.getElementById("quantitative-types-table");
    const qualTable = document.getElementById("qualitative-types-table");
    const protocolTable = document.getElementById("protocol-table");
    if (!quantTable || !qualTable || !protocolTable) {
        return;
    }

    const kindSelect = document.getElementById("kind-select");
    const kindDetailCaption = document.getElementById("kind-detail-caption");
    const catalogueMain = document.querySelector("main.catalogue-main");
    let rulesPanel = document.getElementById("rules-panel");
    let hierarchyPanel = document.getElementById("hierarchy-panel");
    if (!rulesPanel && catalogueMain) {
        rulesPanel = document.createElement("section");
        rulesPanel.id = "rules-panel";
        rulesPanel.className = "panel catalogue-data";
        rulesPanel.innerHTML = `
            <h2>Associative functions</h2>
            <table>
                <thead><tr><th>Rule</th><th>Product</th><th>Strategy</th><th>Threshold</th></tr></thead>
                <tbody id="rules-table"></tbody>
            </table>`;
        catalogueMain.appendChild(rulesPanel);
    }
    if (!hierarchyPanel && catalogueMain) {
        hierarchyPanel = document.createElement("section");
        hierarchyPanel.id = "hierarchy-panel";
        hierarchyPanel.className = "panel";
        hierarchyPanel.innerHTML = `
            <h2>Phenomenon hierarchy</h2>
            <form id="parent-concept-form">
                <label>Child concept
                    <select id="child-concept-select" required></select>
                </label>
                <label>Parent concept (optional)
                    <select id="parent-concept-select"><option value="">None</option></select>
                </label>
                <button type="submit">Save parent</button>
            </form>
            <p id="hierarchy-message" class="message"></p>`;
        catalogueMain.appendChild(hierarchyPanel);
    }

    function syncKindFields() {
        const qualitative = kindSelect.value === "QUALITATIVE";
        kindDetailCaption.textContent = qualitative
            ? "Phenomena (comma separated)"
            : "Allowed units (comma separated)";
    }

    async function refreshCatalogue() {
        const [phenomenonTypes, protocols, rules, phenomena] = await Promise.all([
            request("/api/phenomenon-types"),
            request("/api/protocols"),
            request("/api/associative-functions"),
            request("/api/phenomena")
        ]);

        const quantitative = phenomenonTypes.filter(type => type.measurementKind === "QUANTITATIVE");
        const qualitative = phenomenonTypes.filter(type => type.measurementKind === "QUALITATIVE");

        quantTable.innerHTML = quantitative.length === 0
            ? `<tr><td colspan="3">No quantitative types yet.</td></tr>`
            : quantitative.map(type => {
                const units = (type.allowedUnits || []).join(", ");
                return `
            <tr>
                <td>${escapeHtml(String(type.id))}</td>
                <td>${escapeHtml(type.name)}</td>
                <td>${units ? escapeHtml(units) : "—"}</td>
            </tr>`;
            }).join("");

        qualTable.innerHTML = qualitative.length === 0
            ? `<tr><td colspan="3">No qualitative types yet.</td></tr>`
            : qualitative.map(type => {
                const phenomena = (type.phenomena || []).map(p => p.name).join(", ");
                return `
            <tr>
                <td>${escapeHtml(String(type.id))}</td>
                <td>${escapeHtml(type.name)}</td>
                <td>${phenomena ? escapeHtml(phenomena) : "—"}</td>
            </tr>`;
            }).join("");

        protocolTable.innerHTML = protocols.length === 0
            ? `<tr><td colspan="4">No protocols yet.</td></tr>`
            : protocols.map(protocol => `
            <tr>
                <td>${escapeHtml(String(protocol.id))}</td>
                <td>${escapeHtml(protocol.name)}</td>
                <td>${escapeHtml(protocol.accuracyRating)}</td>
                <td>${protocol.description ? escapeHtml(protocol.description) : "—"}</td>
            </tr>
        `).join("");

        const rulesTable = document.getElementById("rules-table");
        if (rulesTable) {
            rulesTable.innerHTML = rules.map(rule => `
                <tr>
                    <td>${escapeHtml(rule.name)}</td>
                    <td>${escapeHtml(rule.productConceptName)}</td>
                    <td>
                        <select class="rule-strategy-select" data-id="${rule.id}">
                            <option value="CONJUNCTIVE" ${rule.strategyType === "CONJUNCTIVE" ? "selected" : ""}>CONJUNCTIVE</option>
                            <option value="WEIGHTED" ${rule.strategyType === "WEIGHTED" ? "selected" : ""}>WEIGHTED</option>
                        </select>
                    </td>
                    <td><input class="rule-threshold-input" data-id="${rule.id}" type="number" step="0.1" value="${rule.threshold ?? ""}"></td>
                </tr>
            `).join("");
            document.querySelectorAll(".rule-strategy-select, .rule-threshold-input").forEach(element => {
                element.addEventListener("change", async () => {
                    const id = Number(element.dataset.id);
                    const strategy = document.querySelector(`.rule-strategy-select[data-id="${id}"]`).value;
                    const thresholdRaw = document.querySelector(`.rule-threshold-input[data-id="${id}"]`).value;
                    await request(`/api/associative-functions/${id}/strategy`, {
                        method: "PUT",
                        body: JSON.stringify({
                            strategyType: strategy,
                            threshold: thresholdRaw === "" ? null : Number(thresholdRaw)
                        })
                    });
                });
            });
        }

        const childSelect = document.getElementById("child-concept-select");
        const parentSelect = document.getElementById("parent-concept-select");
        if (childSelect && parentSelect) {
            const options = phenomena.map(phen => `<option value="${phen.id}">${escapeHtml(phen.name)}</option>`).join("");
            childSelect.innerHTML = options;
            parentSelect.innerHTML = `<option value="">None</option>${options}`;
        }
    }

    document.getElementById("phenomenon-type-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.target;
        try {
            const qualitative = form.measurementKind.value === "QUALITATIVE";
            const detailValues = form.kindDetail.value.split(",").map(value => value.trim()).filter(Boolean);
            await request("/api/phenomenon-types", {
                method: "POST",
                body: JSON.stringify({
                    name: form.name.value,
                    measurementKind: form.measurementKind.value,
                    allowedUnits: qualitative ? [] : detailValues,
                    phenomena: qualitative ? detailValues : []
                })
            });
            form.reset();
            syncKindFields();
            setMessage("phenomenon-type-message", "Phenomenon type saved");
            await refreshCatalogue();
        } catch (error) {
            setMessage("phenomenon-type-message", error.message, true);
        }
    });

    document.getElementById("protocol-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.target;
        try {
            await request("/api/protocols", {
                method: "POST",
                body: JSON.stringify({
                    name: form.name.value,
                    description: form.description.value,
                    accuracyRating: form.accuracyRating.value
                })
            });
            form.reset();
            setMessage("protocol-message", "Protocol saved");
            await refreshCatalogue();
        } catch (error) {
            setMessage("protocol-message", error.message, true);
        }
    });

    const parentConceptForm = document.getElementById("parent-concept-form");
    if (parentConceptForm) {
        parentConceptForm.addEventListener("submit", async event => {
            event.preventDefault();
            const childId = Number(document.getElementById("child-concept-select").value);
            const parentRaw = document.getElementById("parent-concept-select").value;
            await request(`/api/phenomena/${childId}/parent`, {
                method: "PUT",
                body: JSON.stringify({ parentConceptId: parentRaw ? Number(parentRaw) : null })
            });
            setMessage("hierarchy-message", "Parent concept updated");
        });
    }

    kindSelect.addEventListener("change", syncKindFields);
    syncKindFields();
    await refreshCatalogue();
}

async function loadPatientPage() {
    const patientName = document.getElementById("patient-name");
    if (!patientName) {
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const patientId = params.get("id");

    async function loadLookups() {
        const [types, protocols] = await Promise.all([
            request("/api/phenomenon-types"),
            request("/api/protocols")
        ]);

        const quantitativeTypes = types.filter(type => type.measurementKind === "QUANTITATIVE");
        const qualitativeTypes = types.filter(type => type.measurementKind === "QUALITATIVE");

        const typeSelect = document.getElementById("measurement-type-select");
        typeSelect.innerHTML = quantitativeTypes.map(type => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("");

        const typeMap = new Map(quantitativeTypes.map(type => [String(type.id), type]));
        const unitSelect = document.getElementById("measurement-unit-select");
        function syncUnits() {
            const selected = typeMap.get(typeSelect.value);
            unitSelect.innerHTML = ((selected && selected.allowedUnits) || []).map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`).join("");
        }
        typeSelect.onchange = syncUnits;
        syncUnits();

        const categoryTypeSelect = document.getElementById("category-phenomenon-type-select");
        const phenomenonSelect = document.getElementById("phenomenon-select");
        const qualitativeWithPhenomena = qualitativeTypes.filter(type => (type.phenomena || []).length > 0);

        function syncCategoryPhenomenaOptions() {
            const typeId = categoryTypeSelect.value;
            const selectedType = qualitativeWithPhenomena.find(type => String(type.id) === typeId);
            if (!selectedType) {
                phenomenonSelect.innerHTML = `<option value="">Choose a phenomenon type above</option>`;
                return;
            }
            const phenomena = selectedType.phenomena || [];
            phenomenonSelect.innerHTML = phenomena.map(phenomenon =>
                `<option value="${phenomenon.id}">${escapeHtml(phenomenon.name)}</option>`
            ).join("");
        }

        if (!categoryTypeSelect || !phenomenonSelect) {
            return;
        }

        if (qualitativeWithPhenomena.length === 0) {
            categoryTypeSelect.innerHTML = `<option value="">No qualitative types with phenomena</option>`;
            categoryTypeSelect.disabled = true;
            phenomenonSelect.innerHTML = `<option value="">Add qualitative types on the Catalogue page</option>`;
            phenomenonSelect.disabled = true;
        } else {
            categoryTypeSelect.disabled = false;
            phenomenonSelect.disabled = false;
            categoryTypeSelect.innerHTML = qualitativeWithPhenomena.map(type =>
                `<option value="${type.id}">${escapeHtml(type.name)}</option>`
            ).join("");
            categoryTypeSelect.onchange = syncCategoryPhenomenaOptions;
            syncCategoryPhenomenaOptions();
        }

        const protocolOptionRows = protocols.map(protocol =>
            `<option value="${protocol.id}">${escapeHtml(protocol.name)}</option>`
        ).join("");

        document.getElementById("measurement-protocol-select").innerHTML =
            `<option value="">None</option>${protocolOptionRows}`;
        document.getElementById("category-protocol-select").innerHTML =
            `<option value="">None</option>${protocolOptionRows}`;

        setDefaultApplicabilityInputs();
    }

    async function refreshPatient() {
        const patient = await request(`/api/patients/${patientId}`);
        patientName.textContent = patient.fullName;
        const dob = patient.dateOfBirth
            ? new Date(patient.dateOfBirth + "T12:00:00").toLocaleDateString(undefined, { dateStyle: "long" })
            : "—";
        const note = patient.note && patient.note.trim() ? patient.note : "No note on file";
        document.getElementById("patient-summary").innerHTML = `
            <strong>Date of birth:</strong> ${escapeHtml(dob)}
            &nbsp;·&nbsp;
            <strong>Note:</strong> ${escapeHtml(note)}
        `;
    }

    function renderObservationTypePill(observation) {
        if (observation.observationType === "measurement") {
            return `<span class="obs-type-pill obs-type-pill--measurement">Measurement</span>`;
        }
        return `<span class="obs-type-pill obs-type-pill--category">Category</span>`;
    }

    function renderObservationValueCell(observation) {
        const inferredClass = observation.source === "INFERRED" ? " inferred-observation" : "";
        if (observation.observationType === "measurement") {
            return `
                <td class="obs-cell-value${inferredClass}">
                    <div class="obs-value-block${inferredClass}">
                        <div class="obs-value-main">
                            <span class="amount">${escapeHtml(String(observation.amount))}</span>
                            <span class="unit">${escapeHtml(observation.unit)}</span>
                        </div>
                        <span class="obs-table-meta">${escapeHtml(observation.phenomenonType)}</span>
                    </div>
                </td>`;
        }
        const present = observation.presence === "PRESENT";
        const presenceClass = present ? "presence-badge presence-badge--present" : "presence-badge presence-badge--absent";
        const presenceLabel = present ? "Present" : "Absent";
        return `
                <td class="obs-cell-value${inferredClass}">
                    <div class="obs-value-block${inferredClass}">
                        <div class="obs-concept-line">
                            <span class="obs-concept-name">${escapeHtml(observation.phenomenon)}</span>
                            <span class="${presenceClass}">${presenceLabel}</span>
                        </div>
                        <span class="obs-table-meta">Concept under ${escapeHtml(observation.phenomenonType)}</span>
                    </div>
                </td>`;
    }

    async function refreshObservations() {
        const observations = await request(`/api/patients/${patientId}/observations`);
        document.getElementById("observation-table").innerHTML = observations.map(observation => `
            <tr>
                <td>${escapeHtml(String(observation.id))}</td>
                <td>${renderObservationTypePill(observation)}</td>
                <td>${escapeHtml(observation.phenomenonType)}</td>
                ${renderObservationValueCell(observation)}
                <td>${formatDateTime(observation.applicabilityTime)}</td>
                <td>${formatDateTime(observation.recordingTime)}</td>
                <td>${observation.protocol ? escapeHtml(observation.protocol) : "—"}</td>
                <td>
                    <span class="status ${observation.status}">${escapeHtml(observation.status)}</span>
                    ${observation.rejectionReason ? `<div class="obs-table-meta" style="margin-top:0.35rem">${escapeHtml(observation.rejectionReason)}</div>` : ""}
                    <div class="obs-table-meta">${escapeHtml(observation.source || "MANUAL")}${observation.anomaly ? " · ANOMALY" : ""}</div>
                </td>
                <td>${observation.status === "ACTIVE" ? `<button type="button" data-id="${observation.id}" class="reject-button secondary">Reject</button>` : "—"}</td>
            </tr>
        `).join("");

        document.querySelectorAll(".reject-button").forEach(button => {
            button.addEventListener("click", async () => {
                const reason = window.prompt("Enter rejection reason");
                if (!reason) {
                    return;
                }
                try {
                    await request(`/api/observations/${button.dataset.id}/reject`, {
                        method: "POST",
                        body: JSON.stringify({ reason })
                    });
                    await refreshObservations();
                } catch (error) {
                    alert(error.message);
                }
            });
        });
    }

    document.getElementById("measurement-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.target;
        try {
            await request("/api/observations/measurement", {
                method: "POST",
                body: JSON.stringify({
                    patientId: Number(patientId),
                    phenomenonTypeId: Number(form.phenomenonTypeId.value),
                    amount: Number(form.amount.value),
                    unit: form.unit.value,
                    protocolId: form.protocolId.value ? Number(form.protocolId.value) : null,
                    applicabilityTime: toIsoOrNull(form.applicabilityTime.value)
                })
            });
            form.reset();
            setMessage("measurement-message", "Measurement recorded");
            await loadLookups();
            await refreshObservations();
        } catch (error) {
            setMessage("measurement-message", error.message, true);
        }
    });

    document.getElementById("category-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.target;
        const phenomenonField = form.phenomenonId;
        if (phenomenonField.disabled || !phenomenonField.value) {
            setMessage("category-message", "Choose a phenomenon type and phenomenon.", true);
            return;
        }
        try {
            await request("/api/observations/category", {
                method: "POST",
                body: JSON.stringify({
                    patientId: Number(patientId),
                    phenomenonId: Number(form.phenomenonId.value),
                    presence: form.presence.value,
                    protocolId: form.protocolId.value ? Number(form.protocolId.value) : null,
                    applicabilityTime: toIsoOrNull(form.applicabilityTime.value)
                })
            });
            form.reset();
            setMessage("category-message", "Category observation recorded");
            await loadLookups();
            await refreshObservations();
        } catch (error) {
            setMessage("category-message", error.message, true);
        }
    });

    document.getElementById("evaluate-button").addEventListener("click", async () => {
        try {
            const inferences = await request(`/api/patients/${patientId}/evaluate`, { method: "POST" });
            setMessage("inference-message", inferences.length === 0
                ? "No inferred concepts to show for this patient right now."
                : `${inferences.length} inferred concept(s) from active rules.`);
            document.getElementById("inference-results").innerHTML = inferences.length === 0
                ? `<div class="inference-empty-hint">
                    <p class="obs-table-meta">Rules only use <strong>active</strong> category observations marked <strong>Present</strong>. Measurements are not used. <strong>Rejected</strong> rows do not count.</p>
                    <p class="obs-table-meta">The starter rule needs both <strong>Structural Condition → Poor</strong> and <strong>Symptom → Fever</strong> as Present; it then suggests <strong>Symptom → High Risk</strong> (unless High Risk is already Present). If any of that is missing, the list here stays empty.</p>
                </div>`
                : inferences.map(inference => `
                <div class="inference-card">
                    <div class="inference-card__type">${escapeHtml(inference.phenomenonTypeName)}</div>
                    <div class="inference-card__name">${escapeHtml(inference.phenomenonName)}</div>
                    <div class="obs-table-meta">Strategy: ${escapeHtml(inference.strategyUsed || "UNKNOWN")}</div>
                    ${(inference.evidence || []).length > 0
                        ? `<div class="obs-table-meta">Evidence: ${(inference.evidence || [])
                            .map(item => escapeHtml(item.phenomenonName + " (" + item.presence + ", " + item.source + ")"))
                            .join(", ")}</div>`
                        : ""}
                </div>
            `).join("");
        } catch (error) {
            setMessage("inference-message", error.message, true);
        }
    });

    await refreshPatient();
    await loadLookups();
    await refreshObservations();
}

async function loadLogsPage() {
    const commandTable = document.getElementById("command-log-table");
    if (!commandTable) {
        return;
    }
    const [commandLog, auditLog] = await Promise.all([
        request("/api/command-log"),
        request("/api/audit-log")
    ]);

    commandTable.innerHTML = commandLog.map(entry => `
        <tr>
            <td>${entry.id}</td>
            <td>${entry.commandType}</td>
            <td><pre>${entry.payload}</pre></td>
            <td>${entry.userName}</td>
            <td>${entry.executedAt}</td>
            <td>${entry.undone ? "Undone" : `<button class="undo-button" data-id="${entry.id}">Undo</button>`}</td>
        </tr>
    `).join("");

    document.getElementById("audit-log-table").innerHTML = auditLog.map(entry => `
        <tr>
            <td>${entry.id}</td>
            <td>${entry.event}</td>
            <td>${entry.observationId ?? "-"}</td>
            <td>${entry.patientId}</td>
            <td>${entry.details || "-"}</td>
            <td>${entry.timestamp}</td>
        </tr>
    `).join("");

    document.querySelectorAll(".undo-button").forEach(button => {
        button.addEventListener("click", async () => {
            try {
                await request(`/api/command-log/${button.dataset.id}/undo`, { method: "POST" });
                await loadLogsPage();
            } catch (error) {
                alert(error.message);
            }
        });
    });
}

(async () => {
    try {
        await initUserSession();
    } catch (error) {
        console.error(error);
    }
    await loadIndexPage();
    await loadCataloguePage();
    await loadPatientPage();
    await loadLogsPage();
})();
