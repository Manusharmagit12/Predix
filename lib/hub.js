'use strict';
/**
 * Hub — Server-Sent Events fan-out. One connection per client; public market
 * events broadcast to everyone, private wallet/order/position events are
 * targeted to the authenticated user's connections.
 */
class Hub {
  constructor() { this.clients = new Set(); }

  addClient(res, user) {
    const client = { res, userId: user ? user.id : null, alive: true };
    this.clients.add(client);
    res.on('close', () => { this.clients.delete(client); });
    res.on('error', () => { this.clients.delete(client); });
    return client;
  }

  send(client, event, data) {
    if (!this.clients.has(client)) return;
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(client);
    }
  }

  broadcast(event, data) {
    for (const c of this.clients) this.send(c, event, data);
  }

  sendUser(userId, event, data) {
    for (const c of this.clients) if (c.userId === userId) this.send(c, event, data);
  }

  startKeepAlive() {
    this.timer = setInterval(() => {
      for (const c of this.clients) {
        try { c.res.write(': ping\n\n'); } catch { this.clients.delete(c); }
      }
    }, 25000);
    this.timer.unref();
  }
}

module.exports = { Hub };
