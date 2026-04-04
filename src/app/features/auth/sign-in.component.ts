import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [MatCardModule, MatButtonModule],
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss',
})
export class SignInComponent {
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  isSigningIn = false;
  errorMessage = '';

  async signIn(): Promise<void> {
    if (this.isSigningIn) {
      return;
    }

    this.isSigningIn = true;
    this.errorMessage = '';

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/portfolio';

    try {
      await this.authService.signInWithGoogle();
      await this.router.navigateByUrl(returnUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage = `Sign-in failed: ${message}`;
    } finally {
      this.isSigningIn = false;
    }
  }
}
