import { ServerModel } from './../models/server.model';
import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs'
import { Settings } from '../providers/settings'
import { Config } from './config'
import { ToastController, Platform } from 'ionic-angular';
import { Zeroconf } from '@ionic-native/zeroconf';
/*
  Generated class for the Server provider.

  See https://angular.io/docs/ts/latest/guide/dependency-injection.html
  for more info on providers and Angular 2 DI.
*/
@Injectable()
export class ServerProvider {
  public static ACTION_PUT_SCANSESSIONS = 'putScanSessions';
  public static ACTION_PUT_SCAN = 'putScan';
  public static ACTION_DELETE_SCAN = 'deleteScan';
  public static ACTION_DELETE_SCANSESSION = 'deleteScanSession';
  public static ACTION_GET_VERSION = 'getVersion';
  public static RECONNECT_INTERVAL = 7000;
  public static EVENT_CODE_DO_NOT_ATTEMP_RECCONECTION = 4000; // Another server has been selected, do not attemp to connect again

  private webSocket: WebSocket;
  private observer;
  private reconnectInterval;
  private reconnecting = false;
  private everConnected = false;
  private serverQueue: ServerModel[] = [];

  constructor(
    private settings: Settings,
    private NgZone: NgZone,
    private toastCtrl: ToastController,
    private zeroconf: Zeroconf,
    public platform: Platform
  ) { }

  connect(server: ServerModel): Observable<any> {
    return Observable.create(observer => { // ONLY THE LAST SUBSCRIBER WILL RECEIVE UPDATES!!
      this.observer = observer;
      if (!this.webSocket || this.webSocket.readyState != WebSocket.OPEN) {
        console.log('not connected, creating a new WS connection...');
        this.wsConnect(server);
      } else if (this.webSocket.readyState == WebSocket.OPEN) {
        console.log('already connected to a server, no action taken');
        this.observer.next({ wsAction: 'open' });
      }

      console.log('queue: ', this.serverQueue);
    });
  }

  disconnect(reconnect = false) {
    if (this.webSocket) {
      let code = reconnect ? 1000 : ServerProvider.EVENT_CODE_DO_NOT_ATTEMP_RECCONECTION;
      this.webSocket.close(code);// 1000 = CLOSE_NORMAL
      this.webSocket.removeEventListener('onmessage');
      this.webSocket.removeEventListener('onopen');
      this.webSocket.removeEventListener('onerror');
      this.webSocket.removeEventListener('onclose');
      this.webSocket = null;
      console.log('disconnected(reconnect=' + reconnect + ')');
    }
  }

  private wsConnect(server: ServerModel) {
    console.log('wsConnect(' + server.address + ')', new Date())

    if (this.webSocket && (this.webSocket.readyState == WebSocket.CLOSING || this.webSocket.readyState == WebSocket.CONNECTING)) {
      // If the connection is in one of these two transitioning states the new connection should be queued
      if (!this.serverQueue.find(x => x.equals(server))) {
        this.serverQueue.push(server);
      }
      console.log('WS: the connection is in a transitioning state, the new connection has been queued');
      return;
    }

    if (this.webSocket && this.webSocket.readyState == WebSocket.OPEN) {
      this.serverQueue = []; // if the connection is open the queue is useless and should be emptied
      console.log('WS: the connection is already open, please disconnect before calling wsConnect()')
      return;
    }

    this.disconnect();

    let wsUrl = 'ws://' + server.address + ':' + Config.SERVER_PORT + '/';
    this.webSocket = new WebSocket(wsUrl);
    console.log('WS: A new WebSocket has been created')

    this.webSocket.onmessage = message => {
      let messageData = null;
      if (message.data) {
        messageData = JSON.parse(message.data);
      }
      this.observer.next({ wsAction: 'message', message: messageData });
    }

    this.webSocket.onopen = () => {
      console.log('onopen')
      this.everConnected = true;
      this.serverQueue = [];

      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
        this.reconnecting = false;
        console.log("WS: reconnected successfully... interval cleared.")
      }

      this.settings.saveServer(server);
      this.observer.next({ wsAction: 'open', server: server });

      this.toastCtrl.create({ message: 'Connection established with ' + server.name, duration: 3000 }).present();
    };

    this.webSocket.onerror = err => {
      console.log('onerror')

      if (!this.reconnecting) {
        this.toastCtrl.create({ message: 'Connection problem', duration: 3000 }).present();
      }

      this.observer.next({ wsAction: 'error', err: err });

      this.scheduleNewWsConnection(server);
    }

    this.webSocket.onclose = (ev: CloseEvent) => {
      console.log('onclose')

      if (this.everConnected && !this.reconnecting) {
        this.toastCtrl.create({ message: 'Connection closed', duration: 3000 }).present();
      }
      if (ev.code != ServerProvider.EVENT_CODE_DO_NOT_ATTEMP_RECCONECTION) {
        this.scheduleNewWsConnection(server);
      }

      this.observer.next({ wsAction: 'close' });
    }
  }

  private scheduleNewWsConnection(server) {
    this.reconnecting = true;
    if (!this.reconnectInterval) {
      if (this.serverQueue.length) {
        console.log('server queue is not empty, attemping a new reconnection whithout waiting')
        server = this.serverQueue.shift(); // Removes the first element from an array and returns it
        this.wsConnect(server);
      } else {
        this.reconnectInterval = setInterval(() => {
          this.wsConnect(server);
        }, ServerProvider.RECONNECT_INTERVAL);
      }

      console.log("reconnection scheduled.")
    }
  }

  send(action, data = {}) {
    if (this.webSocket) {
      if (this.webSocket.readyState == WebSocket.OPEN) {
        this.webSocket.send(JSON.stringify({ 'action': action, 'data': data }));
      } else {
        this.toastCtrl.create({ message: 'Connection problem', duration: 3000 }).present();
      }
    } else {
      // console.log("offline mode, cannot send!")
    }
  }

  watchForServers(): Observable<any> {
    return Observable.create(observer => {
      if (this.platform.is('core')) { // for browser support
        observer.next({ server: { address: 'localhost', name: 'localhost' }, action: 'added' });
        return;
      }
      this.unwatch();
      this.zeroconf.watch('_http._tcp.', 'local.').subscribe(result => {
        var action = result.action;
        var service = result.service;
        // console.log("ACTION:", action, service);
        if (service.port == Config.SERVER_PORT && service.ipv4Addresses && service.ipv4Addresses.length) {
          this.NgZone.run(() => {
            service.ipv4Addresses.forEach(ipv4 => {
              if (ipv4) {
                observer.next({ server: new ServerModel(ipv4, service.hostname), action: action });
              }
            })
          });
        }
      });
    });
  }

  unwatch() {
    this.zeroconf.close();
  }

  // isConnectedWith(server: ServerModel) {
  //   if (this.webSocket.readyState != WebSocket.OPEN || this.webSocket.url.indexOf(server.address) == -1) {
  //     return false;
  //   }
  //   return true;
  // }
}
