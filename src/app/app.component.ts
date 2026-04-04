import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly authService = inject(AuthService);

  title = 'StockTrader';
  readonly user = toSignal(this.authService.user$, { initialValue: null });
  readonly isAuthenticated = computed(() => !!this.user());

  navItems = [
    { label: 'Portfolio',     icon: 'show_chart',      route: '/portfolio' },
    { label: 'Accounts',      icon: 'account_balance', route: '/accounts' },
    { label: 'Dividends',     icon: 'payments',        route: '/dividends' },
    { label: 'Analytics',     icon: 'analytics',       route: '/analytics' },
  ];

  async signOut(): Promise<void> {
    await this.authService.signOut();
  }
}
