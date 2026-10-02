const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_NAME = 'SiteTactix Reminders';

/**
 * A 401 means the Google sign-in expired (not a missing Calendar permission).
 */
function signInExpired() {
  return {
    ok: false,
    error: 'needs_auth',
    needsAuth: true,
    message: 'Your Google sign-in expired. Please sign in again.'
  };
}

function getCalendarStorageKey(uid = 'default') {
  return `sitetactix_reminders_calendar_id_${uid || 'default'}`;
}

/**
 * Ensures the "SiteTactix Reminders" calendar exists and returns its ID.
 */
async function getOrCreateRemindersCalendar(googleToken, uid = null) {
  const cacheKey = getCalendarStorageKey(uid);
  let cachedId = null;
  try {
    cachedId = localStorage.getItem(cacheKey);
  } catch {}

  // Check Firestore user_preferences if not in localStorage cache
  if (!cachedId && uid) {
    try {
      const { db } = await import('../../firebase.js');
      const { doc, getDoc } = await import('firebase/firestore');
      const prefDoc = await getDoc(doc(db, 'user_preferences', `calendar_${uid}`));
      if (prefDoc.exists() && prefDoc.data()?.calendarId) {
        cachedId = prefDoc.data().calendarId;
      }
    } catch {
      // Per security rules, reading a non-existent doc returns permission-denied.
      // Treat any read failure as "not created yet" and proceed to create.
    }
  }

  // Verify cached ID if present
  if (cachedId) {
    try {
      const checkRes = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(cachedId)}`, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      if (checkRes.ok) {
        try {
          localStorage.setItem(cacheKey, cachedId);
        } catch {}
        return { ok: true, calendarId: cachedId };
      }
    } catch {}
  }

  // Create new calendar (calendar.app.created scope permits creating app calendars)
  try {
    const createRes = await fetch(`${CALENDAR_API_BASE}/calendars`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: CALENDAR_NAME,
        description: 'Automated task and reminder alerts for SiteTactix.'
      })
    });

    if (createRes.status === 401) {
      return signInExpired();
    }
    if (createRes.status === 403) {
      return {
        ok: false,
        needsAuth: true,
        message: 'I need Google Calendar permission to set reminders — tap Reconnect Google in Settings.'
      };
    }

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { ok: false, error: 'calendar_creation_failed', message: `Could not create reminders calendar: ${errText}` };
    }

    const created = await createRes.json();
    try {
      localStorage.setItem(cacheKey, created.id);
    } catch {}

    // Persist to Firestore user_preferences/calendar_${uid}
    if (uid) {
      try {
        const { db } = await import('../../firebase.js');
        const { doc, setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'user_preferences', `calendar_${uid}`), {
          uid,
          calendarId: created.id,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (saveErr) {
        console.warn('[Reminders] Failed to persist calendarId to user_preferences:', saveErr);
      }
    }

    return { ok: true, calendarId: created.id };
  } catch (err) {
    return { ok: false, error: 'network_error', message: err.message };
  }
}

export async function add_reminder(args = {}, context = {}) {
  const googleToken = context.googleToken;
  const calendarStore = context.calendarStore;
  if (!googleToken && !calendarStore) {
    return {
      ok: false,
      needsAuth: true,
      message: 'I need Google Calendar permission to set reminders — tap Reconnect Google in Settings.'
    };
  }

  const text = String(args.text || '').trim();
  const when = String(args.when || '').trim();

  if (!text || !when) {
    return {
      ok: false,
      error: 'missing_args',
      message: 'Please provide what to remind you about and the scheduled date and time.'
    };
  }

  const startDate = new Date(when);
  if (isNaN(startDate.getTime())) {
    return {
      ok: false,
      error: 'invalid_date',
      message: `I couldn't understand the time "${when}". Please specify a valid date and time.`
    };
  }

  // 15-minute duration
  const endDate = new Date(startDate.getTime() + 15 * 60 * 1000);

  const userTimeZone = context.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';

  function toLocalISOString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  const startPayload = { dateTime: toLocalISOString(startDate), timeZone: userTimeZone };
  const endPayload = { dateTime: toLocalISOString(endDate), timeZone: userTimeZone };

  if (calendarStore) {
    const ev = await calendarStore.addEvent({
      summary: text,
      start: startPayload,
      end: endPayload
    });
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    const formattedDate = startDate.toLocaleString('en-US', options);
    return {
      ok: true,
      added: true,
      event: {
        id: ev.id,
        title: text,
        when: toLocalISOString(startDate),
        formattedTime: formattedDate
      },
      message: `Reminder set: "${text}" for ${formattedDate}.`
    };
  }

  const calResult = await getOrCreateRemindersCalendar(googleToken, context.uid);
  if (!calResult.ok) {
    return calResult;
  }

  try {
    const res = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calResult.calendarId)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: text,
        description: `SiteTactix reminder for project: ${context.projectName || 'Active Project'}`,
        start: startPayload,
        end: endPayload,
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: 0 }]
        }
      })
    });

    if (res.status === 401) {
      return signInExpired();
    }
    if (res.status === 403) {
      return {
        ok: false,
        needsAuth: true,
        message: 'I need Google Calendar permission to set reminders — tap Reconnect Google in Settings.'
      };
    }

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: 'event_creation_failed', message: `Failed to create reminder: ${errText}` };
    }

    const createdEvent = await res.json();

    // Spoken friendly date formatting
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    const formattedDate = startDate.toLocaleString('en-US', options);

    return {
      ok: true,
      added: true,
      event: {
        id: createdEvent.id,
        title: text,
        when: startDate.toISOString(),
        formattedTime: formattedDate
      },
      message: `Reminder set: "${text}" for ${formattedDate}.`
    };
  } catch (err) {
    return { ok: false, error: 'network_error', message: err.message };
  }
}

export async function list_reminders(args = {}, context = {}) {
  const googleToken = context.googleToken;
  const calendarStore = context.calendarStore;
  if (!googleToken && !calendarStore) {
    return {
      ok: false,
      needsAuth: true,
      message: 'I need Google Calendar permission to list reminders — tap Reconnect Google in Settings.'
    };
  }

  if (calendarStore) {
    const rawEvents = await calendarStore.listEvents();
    const formatted = rawEvents.map(e => {
      const dt = new Date(e.start?.dateTime || e.when || new Date());
      return {
        id: e.id,
        title: e.summary || e.title || 'Reminder',
        when: e.start?.dateTime || e.when,
        timeString: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        dateString: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isDone: false
      };
    });
    return {
      ok: true,
      data: {
        count: formatted.length,
        reminders: formatted
      }
    };
  }

  const calResult = await getOrCreateRemindersCalendar(googleToken, context.uid);
  if (!calResult.ok) {
    return calResult;
  }

  let timeMin = args.from ? new Date(args.from).toISOString() : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  let timeMax = args.to ? new Date(args.to).toISOString() : new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

  try {
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calResult.calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${googleToken}` }
    });

    if (res.status === 401) {
      return signInExpired();
    }
    if (res.status === 403) {
      return {
        ok: false,
        needsAuth: true,
        message: 'I need Google Calendar permission to list reminders — tap Reconnect Google in Settings.'
      };
    }

    if (!res.ok) {
      return { ok: false, error: 'fetch_failed', message: 'Failed to retrieve reminders.' };
    }

    const data = await res.json();
    let events = data.items || [];

    if (!args.includeCompleted) {
      events = events.filter(e => e.extendedProperties?.private?.done !== 'true' && !String(e.summary || '').startsWith('✓'));
    }

    const formatted = events.map(e => {
      const dt = new Date(e.start?.dateTime || e.start?.date);
      return {
        id: e.id,
        title: e.summary || 'Reminder',
        when: e.start?.dateTime || e.start?.date,
        timeString: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        dateString: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isDone: e.extendedProperties?.private?.done === 'true' || String(e.summary || '').startsWith('✓')
      };
    });

    return {
      ok: true,
      data: {
        count: formatted.length,
        reminders: formatted
      }
    };
  } catch (err) {
    return { ok: false, error: 'network_error', message: err.message };
  }
}

export async function complete_reminder(args = {}, context = {}) {
  const googleToken = context.googleToken;
  if (!googleToken) {
    return {
      ok: false,
      needsAuth: true,
      message: 'I need Google Calendar permission — tap Reconnect Google in Settings.'
    };
  }

  const calResult = await getOrCreateRemindersCalendar(googleToken, context.uid);
  if (!calResult.ok) {
    return calResult;
  }

  let eventId = args.reminderId || null;

  // If text query provided instead of ID, search upcoming events
  if (!eventId && args.text) {
    const listRes = await list_reminders({ from: new Date().toISOString() }, context);
    if (listRes.ok && listRes.data?.reminders) {
      const q = String(args.text).toLowerCase();
      const matches = listRes.data.reminders.filter(r => r.title.toLowerCase().includes(q));
      if (matches.length === 1) {
        eventId = matches[0].id;
      } else if (matches.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: matches.map(m => m.title),
          message: `Did you mean ${matches.map(m => `"${m.title}"`).join(' or ')}?`
        };
      }
    }
  }

  if (!eventId) {
    return {
      ok: false,
      notFound: true,
      message: `I couldn't find a matching reminder to complete.`
    };
  }

  try {
    const getRes = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calResult.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${googleToken}` }
    });

    if (!getRes.ok) {
      return { ok: false, notFound: true, message: 'Reminder event not found.' };
    }

    const event = await getRes.json();
    const currentSummary = event.summary || '';
    const newSummary = `✓ ${currentSummary.replace(/^[✓\s]+/, '')}`;

    const patchRes = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calResult.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: newSummary,
        extendedProperties: {
          private: {
            done: 'true'
          }
        }
      })
    });

    if (!patchRes.ok) {
      return { ok: false, error: 'patch_failed', message: 'Could not mark reminder complete.' };
    }

    return {
      ok: true,
      completed: true,
      title: newSummary,
      message: `Marked reminder "${currentSummary}" as completed.`
    };
  } catch (err) {
    return { ok: false, error: 'network_error', message: err.message };
  }
}
