import { ServerModel } from './../../models/server.model';
import { ScanModel } from './../../models/scan.model';
import { Component } from '@angular/core';
import { NavController, Slides, ViewController } from 'ionic-angular';
import { ViewChild, NgZone } from '@angular/core';
import { ScanSessionsPage } from '../scan-sessions/scan-sessions';
import { ServerProvider } from '../../providers/server'
import { Config } from '../../providers/config'
import { Settings } from '../../providers/settings'
import { GoogleAnalyticsService } from '../../providers/google-analytics'
import { BarcodeScanner } from '@ionic-native/barcode-scanner';

/*
  Generated class for the Welcome page.

  See http://ionicframework.com/docs/v2/components/#navigation for more info on
  Ionic pages and navigation.
*/
@Component({
  selector: 'page-welcome',
  templateUrl: 'welcome.html'
})
export class WelcomePage {
  @ViewChild('welcome') slider: Slides;
  public showNext = true;
  public connecting = true;

  public lastServerAttempted: ServerModel;

  constructor(
    public navCtrl: NavController,
    private serverProvider: ServerProvider,
    public viewCtrl: ViewController,
    private settings: Settings,
    private ngZone: NgZone,
    private googleAnalytics: GoogleAnalyticsService,
    private barcodeScanner: BarcodeScanner,
  ) { }

  ionViewDidEnter() {
    this.googleAnalytics.trackView("WelcomePage");
  }

  ionViewDidLoad() {
    this.viewCtrl.willLeave.subscribe(() => {
      this.serverProvider.unwatch();
    })

    this.serverProvider.watchForServers().subscribe(data =>
      this.attempConnection(data.server)
    );
  }

  onSkipClicked() {
    this.googleAnalytics.trackEvent('connectivity', 'server_discovery', 'welcome', 0);
    this.navCtrl.setRoot(ScanSessionsPage);
  }

  onNextClicked() {
    this.slider.slideNext();
  }

  onScanQRCodeClicked() {
    this.barcodeScanner.scan({
      "showFlipCameraButton": true, // iOS and Android
    }).then((scan: ScanModel) => {
      if (scan && scan.text) {
        let hostname = this.getParameterByName(scan.text, 'h');
        let addresses = this.getParameterByName(scan.text, 'a').split('-');
        addresses.forEach(address => {
          this.attempConnection(new ServerModel(address, hostname));
        })
      }
    }, err => { });
  }

  startScanningClicked() {
    this.googleAnalytics.trackEvent('connectivity', 'server_discovery', 'welcome', 1);
    this.navCtrl.setRoot(ScanSessionsPage);
  }

  onSlideChanged() {
    this.showNext = !this.slider.isEnd();
  }

  getWebSiteName() {
    return Config.WEBSITE_NAME;
  }

  attempConnection(server: ServerModel) {
    if (this.connecting) {
      this.slider.slideNext();
      this.lastServerAttempted = server;
      this.serverProvider.connect(server).subscribe(obj => {
        let wsAction = obj.wsAction;
        let server = obj.server; // since serverProvider is shared among the app the server object may be different
        if (wsAction == 'open') {
          console.log('connection opened with the server: ', server);
          this.serverProvider.unwatch();
          this.settings.setDefaultServer(server);
          this.slider.slideTo(this.slider.length() - 1);
          this.ngZone.run(() => {
            this.connecting = false;
            this.showNext = false;
          });
        }
      });
    }
  }

  getParameterByName(url, name) {
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
      results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
  }

}
