import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountSnapshotDialogComponent } from './account-snapshot-dialog.component';

describe('AccountSnapshotDialogComponent', () => {
  let component: AccountSnapshotDialogComponent;
  let fixture: ComponentFixture<AccountSnapshotDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountSnapshotDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountSnapshotDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
