import { IsArray, IsBoolean, IsOptional } from 'class-validator';

export class UpdateGroupDto {
  @IsBoolean()
  @IsOptional()
  isProtected?: boolean;

  @IsArray()
  @IsOptional()
  whitelist?: string[];
}
