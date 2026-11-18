import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Logger } from 'pino';
import { config } from './config.js';
import { verifyCitizenToken, verifyToken, type AuthUser } from './auth.js';
import { rooms, type Notifier, type TripService } from './services/tripService.js';
import type { CitizenService } from './services/citizens.js';

/** A citizen car is forgotten this long after its last phone disconnects (allows reloads). */
const CITIZEN_GRACE_MS = 60_000;

/**
 * Socket.IO gateway. Rooms are assigned server-side from the JWT, so a client
 * can never subscribe to a junction or trip it isn't entitled to. On every
 * (re)connect the client gets a snapshot of current state, so a dropped
 * connection never hides a live alert.
 */
export function createRealtime(httpServer: HttpServer, log: Logger) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin.split(',') },
    // Detect dead officer phones quickly.
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const notifier: Notifier = {
    emit(targets, event, payload) {
      io.to(targets).emit(event, payload);
    },
    demoReset() {
      for (const room of io.of('/').adapter.rooms.keys()) {
        if (room.startsWith('trip:')) io.in(room).socketsLeave(room);
      }
      io.emit('demo:reset', { at: Date.now() });
    },
  };

  /**
   * Officer phones connected per junction (primary officers only), e.g. { 7: 3 }.
   * The command centre's phone mockup connects with `preview` and isn't counted.
   */
  function presence(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const s of io.of('/').sockets.values()) {
      if (s.data.preview) continue;
      for (const room of s.rooms) {
        if (room.startsWith('signal:')) {
          const id = Number(room.slice(7));
          out[id] = (out[id] ?? 0) + 1;
        }
      }
    }
    return out;
  }
  const pushPresence = () => io.to(rooms.admin).emit('presence', presence());

  function attach(trips: TripService, citizens: CitizenService) {
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('unauthenticated'));
      try {
        socket.data.user = verifyToken(token);
        socket.data.preview = socket.handshake.auth?.preview === true;
        return next();
      } catch {
        /* not a session token: maybe a citizen */
      }
      try {
        socket.data.citizenId = verifyCitizenToken(token).citizenId;
        next();
      } catch {
        next(new Error('invalid_token'));
      }
    });

    io.on('connection', (socket) => {
      // Citizen phones only ever get their own car's channel.
      const citizenId = socket.data.citizenId as string | undefined;
      if (citizenId) {
        const room = rooms.citizen(citizenId);
        socket.join(room);
        socket.emit('citizen:snapshot', citizens.get(citizenId)); // null if the car was removed (e.g. demo reset)
        socket.on('disconnect', () => {
          setTimeout(() => {
            if (!io.of('/').adapter.rooms.get(room)?.size) citizens.remove(citizenId);
          }, CITIZEN_GRACE_MS).unref();
        });
        return;
      }

      const user = socket.data.user as AuthUser;
      socket.join(rooms.user(user.id));
      if (user.role === 'admin') socket.join(rooms.admin);
      if (user.role === 'hospital' && user.hospitalId) socket.join(rooms.hospital(user.hospitalId));
      if (user.role === 'officer') {
        const mine = trips.officerSignals(user.id);
        for (const id of mine.primary) socket.join(rooms.signal(id));
        for (const id of mine.backup) socket.join(rooms.backup(id));
      }
      const active = trips.activeTripsFor(user);
      if (user.role === 'driver') for (const t of active) socket.join(rooms.trip(t.id));

      socket.emit('snapshot', {
        trips: active,
        alerts: user.role === 'officer' ? trips.officerAlerts(user) : [],
        // Lets the control-room feed survive a page reload.
        events: user.role === 'admin' ? trips.recentEvents() : [],
        presence: user.role === 'admin' ? presence() : {},
        citizens: user.role === 'admin' ? citizens.list() : [],
      });
      if (user.role === 'officer') {
        pushPresence();
        // Rooms are left after 'disconnect' fires, so count on the next tick.
        socket.on('disconnect', () => setImmediate(pushPresence));
      }

      // Drivers join a trip room right after creating a trip.
      socket.on('trip:join', (tripId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
        try {
          if (typeof tripId !== 'number') throw new Error('invalid_trip');
          trips.getTrip(tripId, user); // throws if not permitted
          socket.join(rooms.trip(tripId));
          ack?.({ ok: true });
        } catch (e) {
          ack?.({ ok: false, error: e instanceof Error ? e.message : 'error' });
        }
      });

      log.debug({ userId: user.id, role: user.role }, 'socket connected');
    });
  }

  return { io, notifier, attach };
}
