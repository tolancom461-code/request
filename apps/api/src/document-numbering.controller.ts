import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { DocumentNumberingService } from "./document-numbering.service.js";
import { Permissions, PermissionsGuard } from "./security.js";

@Controller("admin/document-numbering")
@UseGuards(PermissionsGuard)
@Permissions("admin.manage")
export class DocumentNumberingController {
  constructor(@Inject(DocumentNumberingService) private readonly numbering: DocumentNumberingService) {}
  @Get() status() { return this.numbering.status(); }
}
