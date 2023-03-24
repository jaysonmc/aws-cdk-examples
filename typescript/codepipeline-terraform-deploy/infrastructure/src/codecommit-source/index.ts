import { Repository, CfnRepository } from 'aws-cdk-lib/aws-codecommit';
import { CfnRepositoryAssociation } from 'aws-cdk-lib/aws-codegurureviewer';
import { CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import * as codestar from 'aws-cdk-lib/aws-codestar';

export interface CodeCommitSourceProps {
  name: string;
  codeSourceRepo: string;
  codeRepoOwner: string;
  branchName: string;
  associateCodeGuru?: boolean;
}

export class CodeCommitSource extends Construct {
  repository: Repository;
  codePipelineSource: CodePipelineSource;
  
  constructor(scope: Construct, id: string, props: CodeCommitSourceProps) {
    super(scope, id);

    const codeBucket = new Bucket(this, `${props.name}-bucket`, {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    })
    
    new codestar.CfnGitHubRepository(this, `${props.name}-source`, {
      repositoryName: props.codeSourceRepo,
      repositoryOwner: props.codeRepoOwner,
      code: {
        s3: {
          bucket: props.name,
          key: '/',
        },
      }
    })
    
    this.repository = new Repository(this, `${props.name}-repo`, {
      repositoryName: props.name,
    });
    
    const cfnRepo : CfnRepository = this.repository.node.defaultChild as CfnRepository;
    this.repository.node.defaultChild
    
    cfnRepo.addPropertyOverride('Code', {
      S3: {
        Bucket: codeBucket.s3UrlForObject.toString(),
        Key: '/',
      },
      BranchName: props.branchName,
    });

    if (props.associateCodeGuru !== false) {
      new CfnRepositoryAssociation(this, 'CfnRepositoryAssociation', {
        name: this.repository.repositoryName,
        type: 'CodeCommit',
      });
    }
    this.codePipelineSource = CodePipelineSource.codeCommit(this.repository, props.branchName);
  }
}


