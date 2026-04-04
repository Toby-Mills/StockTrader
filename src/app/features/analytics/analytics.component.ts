import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
    standalone: true,
    selector: 'app-analytics',
    imports: [MatCardModule],
    templateUrl: './analytics.component.html',
    styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent {}
