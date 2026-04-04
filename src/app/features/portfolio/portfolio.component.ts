import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
    standalone: true,
    selector: 'app-portfolio',
    imports: [MatCardModule],
    templateUrl: './portfolio.component.html',
    styleUrl: './portfolio.component.scss'
})
export class PortfolioComponent {}
