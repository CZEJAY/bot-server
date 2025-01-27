import { IsString, IsArray, IsOptional, IsBoolean } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  groupId: string;

  @IsString()
  name: string;

  @IsBoolean()
  @IsOptional()
  isProtected?: boolean;

  @IsArray()
  @IsOptional()
  whitelist?: string[];
}
