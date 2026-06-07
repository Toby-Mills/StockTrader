import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
    standalone: true,
    selector: 'app-portfolio',
    imports: [MatCardModule, MatIconModule],
    templateUrl: './portfolio.component.html',
    styleUrl: './portfolio.component.scss'
})
export class PortfolioComponent {}
