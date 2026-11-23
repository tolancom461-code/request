import { Controller, Get, Inject } from "@nestjs/common";
import { DocumentNumberingService } from "./document-numbering.service.js";
import { Permissions } from "./security.js";

@Controller("admin/document-numbering")
@Permissions("admin.manage")
export class DocumentNumberingController {
  constructor(@Inject(DocumentNumberingService) private readonly numbering: DocumentNumberingService) {}
  @Get() status() { return this.numbering.status(); }
}
