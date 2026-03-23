function doPost(e) {
	try {
		var payload = extractPayload_(e);

		if (payload.mode === 'notify') {
			return handleNotification_(payload);
		}

		if (payload.mode === 'attendance') {
			return handleAttendance_(payload);
		}

		var spreadsheetId = payload.spreadsheetId || '10e0iM2qMcTlxXutGjJDYvBZTLmUMtSBbc7_3sWBFoA8';
		var rows = Array.isArray(payload.rows) ? payload.rows : [];

		var ss = SpreadsheetApp.openById(spreadsheetId);
		var groupedRows = groupRowsByCommittee_(rows, payload.committee);
		var inserted = 0;

		Object.keys(groupedRows).forEach(function (committeeKey) {
			var targetSheet = getOrCreateCommitteeSheet_(ss, committeeKey);
			ensureHeaders_(targetSheet);

			var now = new Date();
			var timezone = Session.getScriptTimeZone();
			var horaEnvio = Utilities.formatDate(now, timezone, 'HH:mm:ss');

			var values = groupedRows[committeeKey].map(function (item) {
				return [
					now,
					committeeKey,
					Number(item.rowOrder || 0),
					item.delegation || '',
					Number(item.participacion || 0),
					Number(item.total || 0),
					Number(item.calls != null ? item.calls : item.callAttention || 0),
					Number(item.warnings != null ? item.warnings : item.warning || 0),
					Number(item.participaciones != null ? item.participaciones : item.evaluaciones || 0),
					horaEnvio
				];
			});

			if (values.length > 0) {
				targetSheet.getRange(targetSheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
				inserted += values.length;
			}
		});

		removeLegacyMainSheet_(ss);

		return ContentService
			.createTextOutput(JSON.stringify({ ok: true, mode: 'scores', inserted: inserted }))
			.setMimeType(ContentService.MimeType.JSON);
	} catch (error) {
		return ContentService
			.createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
			.setMimeType(ContentService.MimeType.JSON);
	}
}

function handleAttendance_(payload) {
	var spreadsheetId = payload.spreadsheetId || '10e0iM2qMcTlxXutGjJDYvBZTLmUMtSBbc7_3sWBFoA8';
	var committee = String(payload.committee || 'SIN_COMITE');
	var sheetName = sanitizeSheetName_(payload.sheetName || ('A-' + committee));
	var rows = Array.isArray(payload.rows) ? payload.rows : [];

	var ss = SpreadsheetApp.openById(spreadsheetId);
	var targetSheet = getOrCreateCommitteeSheet_(ss, sheetName);
	ensureAttendanceHeaders_(targetSheet);

	var now = new Date();
	var timezone = Session.getScriptTimeZone();
	var horaEnvio = Utilities.formatDate(now, timezone, 'HH:mm:ss');

	var values = rows.map(function (item, index) {
		return [
			now,
			committee,
			Number(item.rowOrder || index + 1),
			String(item.delegation || ''),
			String(item.present || 'AUSENTE'),
			horaEnvio
		];
	});

	if (values.length > 0) {
		targetSheet.getRange(targetSheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
	}

	return ContentService
		.createTextOutput(JSON.stringify({ ok: true, mode: 'attendance', sheet: sheetName, inserted: values.length }))
		.setMimeType(ContentService.MimeType.JSON);
}

function handleNotification_(payload) {
	var to = String(payload.highCommandEmail || 'victorbanco132@gmail.com').trim();
	if (!to) {
		return ContentService
			.createTextOutput(JSON.stringify({ ok: false, error: 'highCommandEmail vacío' }))
			.setMimeType(ContentService.MimeType.JSON);
	}

	var action = String(payload.action || 'ACCION_SIN_TIPO');
	var committee = String(payload.committee || 'SIN_COMITE');
	var details = payload.details || {};

	var subject = '[MUN ALERTA] ' + action + ' - ' + committee;
	var body = [
		'Se registró una acción sensible en la app MUN.',
		'',
		'Acción: ' + action,
		'Comité: ' + committee,
		'Fecha/Hora: ' + String(payload.timestamp || new Date().toISOString()),
		'',
		'Detalles:',
		JSON.stringify(details, null, 2)
	].join('\n');

	MailApp.sendEmail(to, subject, body);

	return ContentService
		.createTextOutput(JSON.stringify({ ok: true, mode: 'notify', notified: to }))
		.setMimeType(ContentService.MimeType.JSON);
}

function headers_() {
	return [[
		'fecha_envio',
		'comite',
		'orden_fila',
		'delegacion',
		'participacion',
		'total',
		'calls',
		'warnings',
		'participaciones',
		'hora_envio'
	]];
}

function attendanceHeaders_() {
	return [[
		'fecha_envio',
		'comite',
		'orden_fila',
		'delegacion',
		'asistencia',
		'hora_envio'
	]];
}

function ensureHeaders_(sheet) {
	sheet.getRange(1, 1, 1, 10).setValues(headers_());
}

function ensureAttendanceHeaders_(sheet) {
	sheet.getRange(1, 1, 1, 6).setValues(attendanceHeaders_());
}

function sanitizeSheetName_(name) {
	var raw = String(name || 'SIN_COMITE').trim();
	var safe = raw.replace(/[\[\]\*\?\/\\:]/g, '-');
	if (safe.length > 99) {
		safe = safe.substring(0, 99);
	}
	return safe || 'SIN_COMITE';
}

function getOrCreateCommitteeSheet_(ss, committee) {
	var sheetName = sanitizeSheetName_(committee);
	var sheet = ss.getSheetByName(sheetName);
	if (!sheet) {
		sheet = ss.insertSheet(sheetName);
	}
	return sheet;
}

function groupRowsByCommittee_(rows, fallbackCommittee) {
	var grouped = {};
	(rows || []).forEach(function (item) {
		var committee = sanitizeSheetName_(item && item.committee ? item.committee : fallbackCommittee);
		if (!grouped[committee]) {
			grouped[committee] = [];
		}
		grouped[committee].push(item || {});
	});

	if (Object.keys(grouped).length === 0 && fallbackCommittee) {
		grouped[sanitizeSheetName_(fallbackCommittee)] = [];
	}

	return grouped;
}

function removeLegacyMainSheet_(ss) {
	var legacy = ss.getSheetByName('WEBHOOK_CALIFICACIONES');
	if (!legacy) {
		return;
	}

	if (ss.getSheets().length > 1) {
		ss.deleteSheet(legacy);
	}
}

function extractPayload_(e) {
	var payloadText = '{}';

	if (e && e.parameter && e.parameter.payload) {
		payloadText = e.parameter.payload;
	} else if (e && e.postData && e.postData.contents) {
		payloadText = e.postData.contents;

		if (payloadText.indexOf('payload=') === 0) {
			payloadText = payloadText.substring('payload='.length);
			payloadText = payloadText.replace(/\+/g, '%20');
			payloadText = decodeURIComponent(payloadText);
		}
	}

	try {
		return JSON.parse(payloadText || '{}');
	} catch (error) {
		return {};
	}
}
